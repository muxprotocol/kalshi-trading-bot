import { v4 as uuidv4 } from "uuid";
import type { Market, DatabaseManager, Position } from "../utils/database.js";
import type { ModelRouter } from "../clients/modelRouter.js";
import type { KalshiClient } from "../clients/kalshiClient.js";
import { settings } from "../config/settings.js";
import { DebateRunner } from "../agents/debate.js";
import type { GetCompletion } from "../agents/baseAgent.js";
import { getLogger } from "../utils/logger.js";
import { calculateStopLoss } from "../utils/stopLossCalculator.js";

const logger = getLogger("decide");

export interface EnsembleDecision {
  action: "BUY" | "SELL" | "SKIP";
  side?: "YES" | "NO";
  confidence: number;
  limit_price?: number;
  position_size_pct?: number;
  reasoning: string;
}

export function calculateDynamicQuantity(
  balance: number,
  marketPrice: number,
  confidenceDelta: number
): number {
  if (marketPrice <= 0) return 0;
  const baseInvestmentPct = settings.trading.defaultPositionSize / 100;
  const scaler = 1 + settings.trading.positionSizeMultiplier * confidenceDelta;
  const amount = balance * baseInvestmentPct * scaler;
  const maxInvest = (balance * settings.trading.maxPositionSizePct) / 100;
  const finalAmount = Math.min(amount, maxInvest);
  return Math.floor(finalAmount / marketPrice);
}

export async function runEnsembleDecision(
  marketData: Record<string, unknown>,
  newsSummary: string,
  modelRouter: ModelRouter
): Promise<EnsembleDecision | null> {
  const runner = new DebateRunner();
  const completions: Record<string, GetCompletion> = {};
  for (const [modelId, cfg] of Object.entries(settings.ensemble.models)) {
    completions[cfg.role] = async (prompt) =>
      modelRouter.getCompletion({
        prompt,
        model: modelId,
        strategy: "ensemble",
        queryType: "agent_analysis",
        marketId: String(marketData.ticker ?? marketData.market_id ?? ""),
      });
  }
  if (!("trader" in completions)) {
    completions.trader = async (prompt) =>
      modelRouter.getCompletion({
        prompt,
        model: settings.trading.primaryModel,
        strategy: "ensemble",
        queryType: "trader",
        marketId: String(marketData.ticker ?? marketData.market_id ?? ""),
      });
  }
  const enriched = { ...marketData, news_summary: newsSummary };
  const result = await runner.runDebate(enriched, completions);
  if (result.error) {
    logger.warn({ err: result.error }, "Ensemble debate had error");
  }
  if (result.action !== "BUY" && result.action !== "SELL") return null;
  return {
    action: result.action,
    side: result.side,
    confidence: result.confidence,
    limit_price: result.limit_price,
    position_size_pct: result.position_size_pct,
    reasoning: result.reasoning,
  };
}

export async function makeDecisionForMarket(
  market: Market,
  db: DatabaseManager,
  modelRouter: ModelRouter,
  kalshiClient: KalshiClient
): Promise<Position | null> {
  void db;
  void kalshiClient;
  const balanceResp = await kalshiClient.getBalance().catch(() => ({ balance: 0 }));
  const balance = Number(balanceResp.balance ?? 0) / 100;
  const newsSummary = "";

  let decision: EnsembleDecision | null = null;
  if (settings.ensemble.enabled && settings.ensemble.debateEnabled) {
    decision = await runEnsembleDecision(market as unknown as Record<string, unknown>, newsSummary, modelRouter);
  } else {
    const single = await modelRouter.getTradingDecision({ marketData: market as unknown as Record<string, unknown> });
    if (!single || single.action === "SKIP") return null;
    decision = {
      action: single.action,
      side: single.side,
      confidence: single.confidence,
      limit_price: single.limit_price,
      position_size_pct: single.position_size_pct,
      reasoning: single.reasoning ?? "",
    };
  }

  if (!decision || !decision.side) return null;
  if (decision.confidence < settings.trading.minConfidenceToTrade) {
    logger.info({ ticker: market.market_id, conf: decision.confidence }, "Confidence below threshold, skipping");
    return null;
  }

  const sideUpper = decision.side;
  const marketPrice = sideUpper === "YES" ? market.yes_price : market.no_price;
  const limitPriceCents = decision.limit_price ?? Math.max(1, Math.min(99, Math.round(marketPrice * 100)));
  const quantity = calculateDynamicQuantity(
    balance,
    limitPriceCents / 100,
    Math.max(0, decision.confidence - marketPrice)
  );
  if (quantity <= 0) return null;

  const stopCfg = calculateStopLoss(limitPriceCents / 100, sideUpper, decision.confidence);

  const position: Position = {
    market_id: market.market_id,
    side: sideUpper,
    entry_price: limitPriceCents / 100,
    quantity,
    timestamp: new Date().toISOString(),
    rationale: decision.reasoning,
    confidence: decision.confidence,
    strategy: "ensemble",
    status: "pending",
    stop_loss_price: stopCfg.stopLossPrice,
    take_profit_price: stopCfg.takeProfitPrice,
    max_hold_hours: stopCfg.maxHoldHours,
    target_confidence_change: stopCfg.targetConfidenceChange,
  };
  void uuidv4;
  return position;
}
