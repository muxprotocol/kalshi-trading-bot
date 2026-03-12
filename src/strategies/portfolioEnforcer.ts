import { createRequire } from "node:module";
import { CategoryScorer, inferCategory, getAllocationPct, BLOCK_THRESHOLD } from "./categoryScorer.js";

const require = createRequire(import.meta.url);
type DatabaseSyncCtor = new (filename: string) => {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): { lastInsertRowid: number | bigint; changes: number };
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
  };
  close(): void;
};
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
type DatabaseSync = InstanceType<DatabaseSyncCtor>;
import { getLogger } from "../utils/logger.js";

const logger = getLogger("portfolioEnforcer");

export class BlockedTradeError extends Error {
  constructor(message: string, public reason: string) {
    super(message);
    this.name = "BlockedTradeError";
  }
}

export class PortfolioEnforcer {
  private db: DatabaseSync;
  scorer: CategoryScorer;
  private blockedCount = 0;
  private allowedCount = 0;

  constructor(
    private dbPath = "trading_system.db",
    public portfolioValue = 0,
    public maxDrawdownPct = 0.15,
    public maxPositionPct = 0.03,
    public maxSectorPct = 0.3
  ) {
    this.db = new DatabaseSync(dbPath);
    this.scorer = new CategoryScorer(dbPath);
  }

  initialize(): void {
    this.scorer.initialize();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blocked_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        ticker TEXT,
        side TEXT,
        amount REAL,
        category TEXT,
        reason TEXT
      );
    `);
  }

  checkTrade(opts: { ticker: string; side: string; amount: number; title?: string }): void {
    const category = inferCategory(opts.ticker, opts.title ?? "");
    const score = this.scorer.getScore(category);

    if (score < BLOCK_THRESHOLD) {
      this.block(opts.ticker, opts.side, opts.amount, category, `Category score ${score} < ${BLOCK_THRESHOLD}`);
    }

    const maxCategoryAllocation = getAllocationPct(score) * this.portfolioValue;
    const currentExposure = this.getCurrentCategoryExposure(category);
    if (currentExposure + opts.amount > maxCategoryAllocation && maxCategoryAllocation > 0) {
      this.block(
        opts.ticker,
        opts.side,
        opts.amount,
        category,
        `Category exposure would be $${(currentExposure + opts.amount).toFixed(2)} > max $${maxCategoryAllocation.toFixed(2)}`
      );
    }

    const maxPositionSize = this.portfolioValue * this.maxPositionPct;
    if (opts.amount > maxPositionSize && maxPositionSize > 0) {
      this.block(opts.ticker, opts.side, opts.amount, category, `Position $${opts.amount.toFixed(2)} > max $${maxPositionSize.toFixed(2)}`);
    }

    this.allowedCount++;
  }

  private block(ticker: string, side: string, amount: number, category: string, reason: string): never {
    this.blockedCount++;
    this.db
      .prepare(
        `INSERT INTO blocked_trades (timestamp, ticker, side, amount, category, reason) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(new Date().toISOString(), ticker, side, amount, category, reason);
    logger.warn({ ticker, side, amount, category, reason }, "Trade blocked");
    throw new BlockedTradeError(`Trade blocked: ${reason}`, reason);
  }

  private getCurrentCategoryExposure(category: string): number {
    // Sum open positions whose inferred category matches (best-effort)
    const rows = this.db
      .prepare(
        `SELECT p.market_id, p.entry_price, p.quantity
         FROM positions p
         WHERE p.status = 'open'`
      )
      .all() as unknown as Array<{ market_id: string; entry_price: number; quantity: number }>;
    let total = 0;
    for (const r of rows) {
      if (inferCategory(r.market_id) === category) {
        total += r.entry_price * r.quantity;
      }
    }
    return total;
  }

  stats(): { blocked: number; allowed: number } {
    return { blocked: this.blockedCount, allowed: this.allowedCount };
  }

  close(): void {
    this.db.close();
    this.scorer.close();
  }
}
