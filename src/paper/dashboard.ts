import type { DatabaseManager } from "../utils/database.js";
import { evaluatePerformance } from "../jobs/evaluate.js";
import { PaperTradingTracker } from "./tracker.js";

export function renderDashboard(db: DatabaseManager, startingBalance = 1000): string {
  const perf = evaluatePerformance(db);
  const tracker = new PaperTradingTracker(db, startingBalance);
  const snap = tracker.snapshot();

  const lines: string[] = [];
  lines.push("=".repeat(70));
  lines.push("  PAPER TRADING DASHBOARD");
  lines.push("=".repeat(70));
  lines.push(`  Timestamp:      ${snap.timestamp}`);
  lines.push(`  Balance:        $${snap.balance.toFixed(2)}`);
  lines.push(`  Open Positions: ${snap.openPositions}`);
  lines.push(`  Closed Trades:  ${snap.closedTrades}`);
  lines.push(`  Total PnL:      $${snap.totalPnl.toFixed(2)}`);
  lines.push(`  Win Rate:       ${(snap.winRate * 100).toFixed(1)}%`);
  lines.push("-".repeat(70));
  lines.push(`  Avg PnL/Trade:  $${perf.avgPnl.toFixed(2)}`);
  lines.push(`  Best Trade:     $${perf.bestTrade.toFixed(2)}`);
  lines.push(`  Worst Trade:    $${perf.worstTrade.toFixed(2)}`);
  lines.push("-".repeat(70));
  lines.push("  By Category:");
  for (const [cat, data] of Object.entries(perf.byCategory).sort((a, b) => b[1].pnl - a[1].pnl)) {
    const wr = data.trades > 0 ? ((data.wins / data.trades) * 100).toFixed(0) : "0";
    lines.push(`    ${cat.padEnd(16)} trades=${String(data.trades).padStart(4)} wr=${wr}% pnl=$${data.pnl.toFixed(2)}`);
  }
  lines.push("=".repeat(70));
  return lines.join("\n");
}
