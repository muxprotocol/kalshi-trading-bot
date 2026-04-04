import type { DatabaseManager } from "../utils/database.js";
import { CategoryScorer, inferCategory } from "../strategies/categoryScorer.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("evaluate");

export interface PerformanceSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  bestTrade: number;
  worstTrade: number;
  byCategory: Record<string, { trades: number; wins: number; pnl: number }>;
}

export function evaluatePerformance(db: DatabaseManager): PerformanceSummary {
  const logs = db.getTradeLogs(5000);
  const summary: PerformanceSummary = {
    totalTrades: logs.length,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalPnl: 0,
    avgPnl: 0,
    bestTrade: 0,
    worstTrade: 0,
    byCategory: {},
  };
  if (logs.length === 0) return summary;

  let best = -Infinity;
  let worst = Infinity;
  for (const l of logs) {
    summary.totalPnl += l.pnl;
    if (l.pnl > 0) summary.wins++;
    else if (l.pnl < 0) summary.losses++;
    if (l.pnl > best) best = l.pnl;
    if (l.pnl < worst) worst = l.pnl;
    const cat = inferCategory(l.market_id);
    const c = (summary.byCategory[cat] ??= { trades: 0, wins: 0, pnl: 0 });
    c.trades++;
    if (l.pnl > 0) c.wins++;
    c.pnl += l.pnl;
  }
  summary.winRate = summary.wins / summary.totalTrades;
  summary.avgPnl = summary.totalPnl / summary.totalTrades;
  summary.bestTrade = best;
  summary.worstTrade = worst;
  return summary;
}

export function updateCategoryScoresFromTrades(db: DatabaseManager, scorer: CategoryScorer): void {
  const logs = db.getTradeLogs(500);
  for (const l of logs) {
    const cat = inferCategory(l.market_id);
    const roi = l.entry_price > 0 ? l.pnl / (l.entry_price * l.quantity) : 0;
    scorer.updateScore(cat, l.pnl > 0, roi);
  }
  logger.info({ logs: logs.length }, "Category scores updated");
}
