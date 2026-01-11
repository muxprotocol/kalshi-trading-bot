import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { getLogger } from "./logger.js";

const require = createRequire(import.meta.url);
// node:sqlite is loaded via require() to avoid bundler (vite) stripping the
// "node:" prefix. Requires Node 22.5+ with --experimental-sqlite (auto in 24+).
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

const logger = getLogger("database");

export interface Market {
  market_id: string;
  title: string;
  yes_price: number;
  no_price: number;
  volume: number;
  expiration_ts: number;
  category: string;
  status: string;
  last_updated: string;
  has_position?: boolean;
}

export interface Position {
  id?: number;
  market_id: string;
  side: "YES" | "NO";
  entry_price: number;
  quantity: number;
  timestamp: string;
  rationale?: string | null;
  confidence?: number | null;
  live?: boolean;
  status?: "open" | "closed" | "pending";
  strategy?: string | null;
  stop_loss_price?: number | null;
  take_profit_price?: number | null;
  max_hold_hours?: number | null;
  target_confidence_change?: number | null;
}

export interface TradeLog {
  id?: number;
  market_id: string;
  side: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  pnl: number;
  entry_timestamp: string;
  exit_timestamp: string;
  rationale: string;
  strategy?: string | null;
}

export interface LLMQuery {
  id?: number;
  timestamp: string;
  strategy: string;
  query_type: string;
  market_id?: string | null;
  prompt: string;
  response: string;
  tokens_used?: number | null;
  cost_usd?: number | null;
  confidence_extracted?: number | null;
  decision_extracted?: string | null;
}

export class DatabaseManager {
  readonly dbPath: string;
  private db: DatabaseSync | null = null;
  private initialized = false;

  constructor(dbPath = "trading_system.db") {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const dir = path.dirname(path.resolve(this.dbPath));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.createSchema();
    this.initialized = true;
    logger.info({ path: this.dbPath }, "Database initialized");
  }

  private ensureDb(): DatabaseSync {
    if (!this.db) throw new Error("Database not initialized");
    return this.db;
  }

  private createSchema(): void {
    const db = this.ensureDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS markets (
        market_id TEXT PRIMARY KEY,
        title TEXT,
        yes_price REAL,
        no_price REAL,
        volume INTEGER,
        expiration_ts INTEGER,
        category TEXT,
        status TEXT,
        last_updated TEXT
      );

      CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_id TEXT NOT NULL,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        quantity INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        rationale TEXT,
        confidence REAL,
        live INTEGER DEFAULT 0,
        status TEXT DEFAULT 'open',
        strategy TEXT,
        stop_loss_price REAL,
        take_profit_price REAL,
        max_hold_hours INTEGER,
        target_confidence_change REAL
      );

      CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id);
      CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);

      CREATE TABLE IF NOT EXISTS trade_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_id TEXT NOT NULL,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL NOT NULL,
        quantity INTEGER NOT NULL,
        pnl REAL NOT NULL,
        entry_timestamp TEXT NOT NULL,
        exit_timestamp TEXT NOT NULL,
        rationale TEXT,
        strategy TEXT
      );

      CREATE TABLE IF NOT EXISTS llm_queries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        strategy TEXT,
        query_type TEXT,
        market_id TEXT,
        prompt TEXT,
        response TEXT,
        tokens_used INTEGER,
        cost_usd REAL,
        confidence_extracted REAL,
        decision_extracted TEXT
      );

      CREATE TABLE IF NOT EXISTS blocked_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        ticker TEXT,
        side TEXT,
        amount REAL,
        category TEXT,
        reason TEXT
      );

      CREATE TABLE IF NOT EXISTS category_scores (
        category TEXT PRIMARY KEY,
        score REAL,
        total_trades INTEGER,
        wins INTEGER,
        total_pnl REAL,
        recent_trend REAL,
        updated_at TEXT
      );
    `);
  }

  upsertMarket(m: Market): void {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT INTO markets (market_id, title, yes_price, no_price, volume, expiration_ts, category, status, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(market_id) DO UPDATE SET
        title=excluded.title,
        yes_price=excluded.yes_price,
        no_price=excluded.no_price,
        volume=excluded.volume,
        expiration_ts=excluded.expiration_ts,
        category=excluded.category,
        status=excluded.status,
        last_updated=excluded.last_updated
    `);
    stmt.run(
      m.market_id,
      m.title,
      m.yes_price,
      m.no_price,
      m.volume,
      m.expiration_ts,
      m.category,
      m.status,
      m.last_updated
    );
  }

  upsertMarkets(markets: Market[]): void {
    const db = this.ensureDb();
    db.exec("BEGIN");
    try {
      for (const m of markets) this.upsertMarket(m);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  getEligibleMarkets(volumeMin = 500, maxDaysToExpiry = 14): Market[] {
    const db = this.ensureDb();
    const now = Date.now() / 1000;
    const maxTs = now + maxDaysToExpiry * 86400;
    const rows = db
      .prepare(
        `SELECT * FROM markets
         WHERE volume >= ?
           AND expiration_ts > ?
           AND expiration_ts <= ?
           AND status = 'open'
         ORDER BY volume DESC
         LIMIT 500`
      )
      .all(volumeMin, now, maxTs) as unknown as Market[];
    return rows;
  }

  getAllMarkets(limit = 1000): Market[] {
    const db = this.ensureDb();
    return db.prepare("SELECT * FROM markets LIMIT ?").all(limit) as unknown as Market[];
  }

  insertPosition(p: Position): number {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT INTO positions (market_id, side, entry_price, quantity, timestamp, rationale, confidence,
        live, status, strategy, stop_loss_price, take_profit_price, max_hold_hours, target_confidence_change)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      p.market_id,
      p.side,
      p.entry_price,
      p.quantity,
      p.timestamp,
      p.rationale ?? null,
      p.confidence ?? null,
      p.live ? 1 : 0,
      p.status ?? "open",
      p.strategy ?? null,
      p.stop_loss_price ?? null,
      p.take_profit_price ?? null,
      p.max_hold_hours ?? null,
      p.target_confidence_change ?? null
    );
    return Number(info.lastInsertRowid);
  }

  getOpenPositions(): Position[] {
    const db = this.ensureDb();
    return db.prepare("SELECT * FROM positions WHERE status = 'open'").all() as unknown as Position[];
  }

  getPositionsByMarket(marketId: string): Position[] {
    const db = this.ensureDb();
    return db
      .prepare("SELECT * FROM positions WHERE market_id = ? AND status = 'open'")
      .all(marketId) as unknown as Position[];
  }

  closePosition(id: number, exitPrice: number, pnl: number, exitTs: string): void {
    const db = this.ensureDb();
    const pos = db.prepare("SELECT * FROM positions WHERE id = ?").get(id) as unknown as Position | undefined;
    if (!pos) return;
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE positions SET status = 'closed' WHERE id = ?").run(id);
      db.prepare(
        `INSERT INTO trade_logs (market_id, side, entry_price, exit_price, quantity, pnl, entry_timestamp, exit_timestamp, rationale, strategy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        pos.market_id,
        pos.side,
        pos.entry_price,
        exitPrice,
        pos.quantity,
        pnl,
        pos.timestamp,
        exitTs,
        pos.rationale ?? "",
        pos.strategy ?? null
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  insertLLMQuery(q: LLMQuery): number {
    const db = this.ensureDb();
    const info = db
      .prepare(
        `INSERT INTO llm_queries (timestamp, strategy, query_type, market_id, prompt, response, tokens_used, cost_usd, confidence_extracted, decision_extracted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        q.timestamp,
        q.strategy,
        q.query_type,
        q.market_id ?? null,
        q.prompt,
        q.response,
        q.tokens_used ?? null,
        q.cost_usd ?? null,
        q.confidence_extracted ?? null,
        q.decision_extracted ?? null
      );
    return Number(info.lastInsertRowid);
  }

  logBlockedTrade(ticker: string, side: string, amount: number, category: string, reason: string): void {
    const db = this.ensureDb();
    db.prepare(
      `INSERT INTO blocked_trades (timestamp, ticker, side, amount, category, reason) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(new Date().toISOString(), ticker, side, amount, category, reason);
  }

  getTradeLogs(limit = 500): TradeLog[] {
    const db = this.ensureDb();
    return db
      .prepare("SELECT * FROM trade_logs ORDER BY entry_timestamp DESC LIMIT ?")
      .all(limit) as unknown as TradeLog[];
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }
}
