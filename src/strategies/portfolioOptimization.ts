import type { Market } from "../utils/database.js";
import { getLogger } from "../utils/logger.js";
import { settings } from "../config/settings.js";

const logger = getLogger("portfolioOpt");

export interface MarketOpportunity {
  ticker: string;
  title: string;
  modelProbability: number;
  marketPrice: number;
  side: "YES" | "NO";
  confidence: number;
  edge: number;
  volume: number;
  expectedReturn: number;
  volatility: number;
}

export interface PortfolioAllocation {
  ticker: string;
  side: "YES" | "NO";
  amount: number;
  quantity: number;
  limitPriceCents: number;
  expectedReturn: number;
  kellyFraction: number;
  edge: number;
  confidence: number;
}

export interface PortfolioOptimizationResult {
  allocations: PortfolioAllocation[];
  totalCapitalUsed: number;
  expectedReturn: number;
  portfolioVolatility: number;
  sharpe: number;
}

export function kellyFraction(prob: number, price: number): number {
  if (price <= 0 || price >= 1) return 0;
  const edge = prob - price;
  if (edge <= 0) return 0;
  const b = (1 - price) / price;
  const q = 1 - prob;
  const f = (prob * b - q) / b;
  return Math.max(0, Math.min(0.25, f));
}

export class AdvancedPortfolioOptimizer {
  constructor(
    public totalCapital: number,
    public kellyFractionCoef = settings.trading.kellyFraction,
    public maxSinglePosition = settings.trading.maxSinglePosition,
    public minPositionSize = settings.minPositionSize,
    public maxOpportunities = settings.maxOpportunitiesPerBatch
  ) {}

  optimize(opportunities: MarketOpportunity[]): PortfolioOptimizationResult {
    const sorted = [...opportunities]
      .sort((a, b) => b.edge * b.confidence - a.edge * a.confidence)
      .slice(0, this.maxOpportunities);

    const allocations: PortfolioAllocation[] = [];
    let remaining = this.totalCapital;
    let totalExpReturn = 0;
    let totalVar = 0;

    for (const opp of sorted) {
      const price = opp.side === "YES" ? opp.marketPrice : 1 - opp.marketPrice;
      const prob = opp.side === "YES" ? opp.modelProbability : 1 - opp.modelProbability;
      const kelly = kellyFraction(prob, price);
      const fraction = Math.min(kelly * this.kellyFractionCoef, this.maxSinglePosition);
      const alloc = Math.min(remaining, this.totalCapital * fraction);
      if (alloc < this.minPositionSize) continue;
      const limitPriceCents = Math.max(1, Math.min(99, Math.round(price * 100)));
      const qty = Math.floor(alloc / (limitPriceCents / 100));
      if (qty <= 0) continue;
      const expReturn = opp.expectedReturn * alloc;
      const variance = Math.max(1e-6, opp.volatility ** 2) * alloc ** 2;
      allocations.push({
        ticker: opp.ticker,
        side: opp.side,
        amount: alloc,
        quantity: qty,
        limitPriceCents,
        expectedReturn: expReturn,
        kellyFraction: fraction,
        edge: opp.edge,
        confidence: opp.confidence,
      });
      remaining -= alloc;
      totalExpReturn += expReturn;
      totalVar += variance;
      if (remaining <= this.minPositionSize) break;
    }

    const portfolioVolatility = Math.sqrt(totalVar) / Math.max(1, this.totalCapital);
    const sharpe = portfolioVolatility > 0 ? totalExpReturn / (this.totalCapital * portfolioVolatility) : 0;

    logger.info(
      {
        allocations: allocations.length,
        capitalUsed: this.totalCapital - remaining,
        expectedReturn: totalExpReturn,
      },
      "Portfolio optimized"
    );

    return {
      allocations,
      totalCapitalUsed: this.totalCapital - remaining,
      expectedReturn: totalExpReturn,
      portfolioVolatility,
      sharpe,
    };
  }
}

export function createMarketOpportunitiesFromMarkets(
  markets: Market[],
  predictions: Map<string, { probability: number; confidence: number }>
): MarketOpportunity[] {
  const out: MarketOpportunity[] = [];
  for (const m of markets) {
    const p = predictions.get(m.market_id);
    if (!p) continue;
    const yesPrice = m.yes_price;
    const yesEdge = p.probability - yesPrice;
    const noEdge = 1 - p.probability - m.no_price;
    if (Math.abs(yesEdge) < settings.minTradeEdge && Math.abs(noEdge) < settings.minTradeEdge) continue;
    const side: "YES" | "NO" = yesEdge >= noEdge ? "YES" : "NO";
    const edge = Math.max(yesEdge, noEdge);
    const price = side === "YES" ? yesPrice : m.no_price;
    const prob = side === "YES" ? p.probability : 1 - p.probability;
    const volatility = 0.3;
    const expectedReturn = prob * (1 - price) - (1 - prob) * price;
    out.push({
      ticker: m.market_id,
      title: m.title,
      modelProbability: p.probability,
      marketPrice: price,
      side,
      confidence: p.confidence,
      edge,
      volume: m.volume,
      expectedReturn,
      volatility,
    });
  }
  return out;
}

export async function runPortfolioOptimization(
  opportunities: MarketOpportunity[],
  totalCapital: number
): Promise<PortfolioOptimizationResult> {
  const optimizer = new AdvancedPortfolioOptimizer(totalCapital);
  return optimizer.optimize(opportunities);
}
