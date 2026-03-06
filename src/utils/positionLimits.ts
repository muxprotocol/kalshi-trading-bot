import { settings } from "../config/settings.js";
import type { DatabaseManager, Position } from "./database.js";
import type { KalshiClient } from "../clients/kalshiClient.js";
import { getLogger } from "./logger.js";

const logger = getLogger("positionLimits");

export interface PositionLimitResult {
  canTrade: boolean;
  reason: string;
  currentPositions: number;
  maxPositions: number;
  currentPortfolioUsage: number;
  maxPositionSize: number;
  recommendedActions: string[];
}

export interface PositionToClose {
  positionId: number;
  marketId: string;
  side: string;
  currentPnl: number;
  confidence: number;
  ageHours: number;
  priorityScore: number;
}

export class PositionLimitEnforcer {
  constructor(
    private db: DatabaseManager,
    private kalshi: KalshiClient
  ) {}

  async checkLimits(proposedAmount: number): Promise<PositionLimitResult> {
    const open = this.db.getOpenPositions();
    const balance = await this.getBalance();
    const currentPositions = open.length;
    const maxPositions = settings.trading.maxPositions;
    const maxPositionSize = balance * (settings.trading.maxPositionSizePct / 100);
    const exposure = open.reduce((s, p) => s + p.entry_price * p.quantity, 0);
    const currentPortfolioUsage = balance > 0 ? exposure / balance : 0;

    if (currentPositions >= maxPositions) {
      return {
        canTrade: false,
        reason: `At max positions (${currentPositions}/${maxPositions})`,
        currentPositions,
        maxPositions,
        currentPortfolioUsage,
        maxPositionSize,
        recommendedActions: ["Close worst-performing position"],
      };
    }
    if (proposedAmount > maxPositionSize) {
      return {
        canTrade: false,
        reason: `Proposed $${proposedAmount.toFixed(2)} exceeds max $${maxPositionSize.toFixed(2)}`,
        currentPositions,
        maxPositions,
        currentPortfolioUsage,
        maxPositionSize,
        recommendedActions: [`Reduce position to <= $${maxPositionSize.toFixed(2)}`],
      };
    }
    return {
      canTrade: true,
      reason: "ok",
      currentPositions,
      maxPositions,
      currentPortfolioUsage,
      maxPositionSize,
      recommendedActions: [],
    };
  }

  private async getBalance(): Promise<number> {
    try {
      const r = await this.kalshi.getBalance();
      return Number(r.balance ?? 0) / 100;
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "Could not fetch balance; defaulting to 0");
      return 0;
    }
  }

  async rankPositionsForClosure(): Promise<PositionToClose[]> {
    const open = this.db.getOpenPositions();
    const now = Date.now();
    const out: PositionToClose[] = [];
    for (const p of open) {
      const ageMs = now - new Date(p.timestamp).getTime();
      const ageHours = ageMs / 3600_000;
      const priority = ageHours * 0.1 + (1 - (p.confidence ?? 0.5)) * 2;
      out.push({
        positionId: p.id ?? -1,
        marketId: p.market_id,
        side: p.side,
        currentPnl: 0,
        confidence: p.confidence ?? 0.5,
        ageHours,
        priorityScore: priority,
      });
    }
    out.sort((a, b) => b.priorityScore - a.priorityScore);
    return out;
  }
}
