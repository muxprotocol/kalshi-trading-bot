import fs from "node:fs";
import path from "node:path";
import type { DatabaseManager } from "../utils/database.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("paperTracker");

export interface PaperSnapshot {
  timestamp: string;
  openPositions: number;
  closedTrades: number;
  totalPnl: number;
  winRate: number;
  balance: number;
}

export class PaperTradingTracker {
  private snapshotFile: string;

  constructor(private db: DatabaseManager, private startingBalance = 1000) {
    this.snapshotFile = "logs/paper_snapshots.json";
  }

  snapshot(): PaperSnapshot {
    const open = this.db.getOpenPositions();
    const logs = this.db.getTradeLogs(10_000);
    const totalPnl = logs.reduce((s, l) => s + l.pnl, 0);
    const wins = logs.filter((l) => l.pnl > 0).length;
    const winRate = logs.length > 0 ? wins / logs.length : 0;
    const balance = this.startingBalance + totalPnl;
    const snap: PaperSnapshot = {
      timestamp: new Date().toISOString(),
      openPositions: open.length,
      closedTrades: logs.length,
      totalPnl,
      winRate,
      balance,
    };
    this.appendSnapshot(snap);
    return snap;
  }

  private appendSnapshot(snap: PaperSnapshot): void {
    try {
      const dir = path.dirname(this.snapshotFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let arr: PaperSnapshot[] = [];
      if (fs.existsSync(this.snapshotFile)) {
        try {
          arr = JSON.parse(fs.readFileSync(this.snapshotFile, "utf8")) as PaperSnapshot[];
          if (!Array.isArray(arr)) arr = [];
        } catch {
          arr = [];
        }
      }
      arr.push(snap);
      if (arr.length > 10_000) arr = arr.slice(-10_000);
      fs.writeFileSync(this.snapshotFile, JSON.stringify(arr, null, 2));
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "Failed to persist snapshot");
    }
  }
}
