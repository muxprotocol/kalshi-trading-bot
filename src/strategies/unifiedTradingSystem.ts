import type { KalshiClient } from "../clients/kalshiClient.js";
import type { ModelRouter } from "../clients/modelRouter.js";
import type { DatabaseManager, Market } from "../utils/database.js";
import { settings } from "../config/settings.js";
import { getLogger } from "../utils/logger.js";
import {
  runMarketMakingStrategy,
  type MarketMakingResult,
} from "./marketMaking.js";
import {
  AdvancedPortfolioOptimizer,
  createMarketOpportunitiesFromMarkets,
  type PortfolioOptimizationResult,
} from "./portfolioOptimization.js";
import { DebateRunner } from "../agents/debate.js";
import type { GetCompletion } from "../agents/baseAgent.js";

const logger = getLogger("unifiedTradingSystem");

export interface TradingSystemConfig {
  marketMakingAllocation: number;
  directionalTradingAllocation: number;
  arbitrageAllocation: number;
  maxPortfolioVolatility: number;
  maxCorrelationExposure: number;
  maxSinglePosition: number;
  targetSharpeRatio: number;
  targetAnnualReturn: number;
  maxDrawdownLimit: number;
  rebalanceFrequencyHours: number;
  profitTakingThreshold: number;
  lossCuttingThreshold: number;
}

export interface TradingSystemResults {
  marketMakingOrders: number;
  marketMakingExposure: number;
  marketMakingExpectedProfit: number;
  directionalPositions: number;
  directionalExposure: number;
  directionalExpectedReturn: number;
  totalCapitalUsed: number;
  portfolioExpectedReturn: number;
  portfolioSharpeRatio: number;
  portfolioVolatility: number;
  maxPortfolioDrawdown: number;
  correlationScore: number;
  diversificationRatio: number;
  totalPositions: number;
  capitalEfficiency: number;
  expectedAnnualReturn: number;
}

export function defaultTradingSystemConfig(): TradingSystemConfig {
  return {
    marketMakingAllocation: 0.3,
    directionalTradingAllocation: 0.7,
    arbitrageAllocation: 0,
    maxPortfolioVolatility: 0.2,
    maxCorrelationExposure: 0.7,
    maxSinglePosition: 0.15,
    targetSharpeRatio: 2.0,
    targetAnnualReturn: 0.3,
    maxDrawdownLimit: 0.15,
    rebalanceFrequencyHours: 6,
    profitTakingThreshold: 0.25,
    lossCuttingThreshold: 0.1,
  };
}

export async function runUnifiedTradingSystem(
  db: DatabaseManager,
  client: KalshiClient,
  modelRouter: ModelRouter,
  config: TradingSystemConfig
): Promise<TradingSystemResults> {
  const results: TradingSystemResults = {
    marketMakingOrders: 0,
    marketMakingExposure: 0,
    marketMakingExpectedProfit: 0,
    directionalPositions: 0,
    directionalExposure: 0,
    directionalExpectedReturn: 0,
    totalCapitalUsed: 0,
    portfolioExpectedReturn: 0,
    portfolioSharpeRatio: 0,
    portfolioVolatility: 0,
    maxPortfolioDrawdown: 0,
    correlationScore: 0,
    diversificationRatio: 0,
    totalPositions: 0,
    capitalEfficiency: 0,
    expectedAnnualReturn: 0,
  };

  let balance = 0;
  try {
    const r = await client.getBalance();
    balance = Number(r.balance ?? 0) / 100;
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "Could not fetch balance");
  }
  if (balance < settings.trading.minBalance) {
    logger.warn({ balance }, "Below min balance; skipping cycle");
    return results;
  }

  const dryRun = !settings.trading.liveTradingEnabled;

  // Market making
  if (settings.enableMarketMaking && config.marketMakingAllocation > 0) {
    const mmCapital = balance * config.marketMakingAllocation;
    try {
      const mmRes: MarketMakingResult = await runMarketMakingStrategy(db, client, mmCapital, dryRun);
      results.marketMakingOrders = mmRes.ordersPlaced;
      results.marketMakingExposure = mmRes.exposure;
      results.marketMakingExpectedProfit = mmRes.expectedProfit;
    } catch (e) {
      logger.error({ err: (e as Error).message }, "Market making failed");
    }
  }

  // Directional via AI debate + portfolio optimization
  if (config.directionalTradingAllocation > 0) {
    const dirCapital = balance * config.directionalTradingAllocation;
    const markets = db.getEligibleMarkets(settings.minVolumeForAnalysis, settings.trading.maxTimeToExpiryDays).slice(0, 10);
    const predictions = new Map<string, { probability: number; confidence: number }>();

    const debate = new DebateRunner();
    for (const m of markets) {
      const completions: Record<string, GetCompletion> = {};
      for (const [modelId, cfg] of Object.entries(settings.ensemble.models)) {
        completions[cfg.role] = async (prompt) =>
          modelRouter.getCompletion({
            prompt,
            model: modelId,
            strategy: "ensemble",
            queryType: "agent_analysis",
            marketId: m.market_id,
          });
      }
      if (!("trader" in completions)) {
        completions.trader = async (prompt) =>
          modelRouter.getCompletion({
            prompt,
            model: settings.trading.primaryModel,
            strategy: "ensemble",
            queryType: "trader_decision",
            marketId: m.market_id,
          });
      }
      const enriched = { ...m, news_summary: "" };
      try {
        const res = await debate.runDebate(enriched, completions);
        const prob = res.action === "SKIP" ? null : res.side === "YES" ? res.confidence : 1 - res.confidence;
        if (prob !== null && res.confidence >= settings.trading.minConfidenceToTrade) {
          predictions.set(m.market_id, { probability: prob, confidence: res.confidence });
        }
      } catch (e) {
        logger.warn({ ticker: m.market_id, err: (e as Error).message }, "Debate failed");
      }
    }

    if (predictions.size > 0) {
      const opps = createMarketOpportunitiesFromMarkets(markets as Market[], predictions);
      const optimizer = new AdvancedPortfolioOptimizer(dirCapital);
      const opt: PortfolioOptimizationResult = optimizer.optimize(opps);
      results.directionalPositions = opt.allocations.length;
      results.directionalExposure = opt.totalCapitalUsed;
      results.directionalExpectedReturn = opt.expectedReturn;
      results.portfolioSharpeRatio = opt.sharpe;
      results.portfolioVolatility = opt.portfolioVolatility;

      if (!dryRun) {
        for (const a of opt.allocations) {
          try {
            await client.placeOrder({
              ticker: a.ticker,
              clientOrderId: crypto.randomUUID(),
              side: a.side.toLowerCase() as "yes" | "no",
              action: "buy",
              count: a.quantity,
              type: "limit",
              ...(a.side === "YES" ? { yesPrice: a.limitPriceCents } : { noPrice: a.limitPriceCents }),
            });
          } catch (e) {
            logger.error({ ticker: a.ticker, err: (e as Error).message }, "Directional order failed");
          }
        }
      } else {
        logger.info({ count: opt.allocations.length }, "DRY RUN directional orders");
      }
    }
  }

  results.totalCapitalUsed = results.marketMakingExposure + results.directionalExposure;
  results.totalPositions = results.marketMakingOrders + results.directionalPositions;
  results.capitalEfficiency = balance > 0 ? results.totalCapitalUsed / balance : 0;
  results.portfolioExpectedReturn = results.directionalExpectedReturn + results.marketMakingExpectedProfit;
  results.expectedAnnualReturn = results.portfolioExpectedReturn / Math.max(1, balance);

  return results;
}
