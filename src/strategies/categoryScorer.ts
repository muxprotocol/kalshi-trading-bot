import { createRequire } from "node:module";
import { getLogger } from "../utils/logger.js";

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

const logger = getLogger("categoryScorer");

export const W_ROI = 0.4;
export const W_SAMPLE = 0.2;
export const W_TREND = 0.25;
export const W_WINRATE = 0.15;
export const BLOCK_THRESHOLD = 30;
export const MIN_SAMPLES_FOR_SCORING = 5;

export const ALLOCATION_TIERS: Array<[number, number]> = [
  [80, 0.2],
  [60, 0.1],
  [40, 0.05],
  [30, 0.02],
  [0, 0.0],
];

export const KNOWN_DATA: Record<
  string,
  { wins: number; total: number; total_pnl: number; recent_trend: number }
> = {
  NCAAB: { wins: 37, total: 50, total_pnl: 5.0, recent_trend: 0.15 },
  ECON: { wins: 22, total: 100, total_pnl: -70.0, recent_trend: -0.8 },
  CPI: { wins: 12, total: 50, total_pnl: -35.0, recent_trend: -0.75 },
  FED: { wins: 16, total: 50, total_pnl: -20.0, recent_trend: -0.5 },
  ECON_MACRO: { wins: 18, total: 60, total_pnl: -33.0, recent_trend: -0.65 },
};

export interface CategoryScoreRow {
  category: string;
  score: number;
  win_count: number;
  total_count: number;
  total_pnl: number;
  recent_trend: number;
  last_updated: string;
  blocked: number;
}

export function computeScore(
  winRate: number,
  avgRoi: number,
  sampleSize: number,
  recentTrend: number
): number {
  const roiNormalized = Math.max(0, Math.min(1, (avgRoi + 1) / 1.5));
  const roiScore = roiNormalized * 100;
  const sampleScore =
    sampleSize <= 0
      ? 0
      : Math.min(40, (Math.log(sampleSize + 1) / Math.log(200)) * 100 * 0.8);
  const trendScore = Math.max(0, Math.min(100, ((recentTrend + 1) / 2) * 100));
  const winrateScore = Math.max(0, Math.min(100, winRate * 100));
  const total = roiScore * W_ROI + sampleScore * W_SAMPLE + trendScore * W_TREND + winrateScore * W_WINRATE;
  return Math.round(total * 10) / 10;
}

export function getAllocationPct(score: number): number {
  for (const [min, pct] of ALLOCATION_TIERS) {
    if (score >= min) return pct;
  }
  return 0;
}

export function isBlocked(score: number): boolean {
  return score < BLOCK_THRESHOLD || getAllocationPct(score) === 0;
}

export class CategoryScorer {
  private db: DatabaseSync;
  private cache = new Map<string, { data: CategoryScoreRow; ts: number }>();
  private cacheTtlMs = 15 * 60 * 1000;

  constructor(dbPath = "trading_system.db") {
    this.db = new DatabaseSync(dbPath);
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS category_scores (
        category TEXT PRIMARY KEY,
        score REAL NOT NULL DEFAULT 50.0,
        win_count INTEGER NOT NULL DEFAULT 0,
        total_count INTEGER NOT NULL DEFAULT 0,
        total_pnl REAL NOT NULL DEFAULT 0.0,
        recent_trend REAL NOT NULL DEFAULT 0.0,
        last_updated TEXT NOT NULL,
        blocked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS category_trade_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        won INTEGER NOT NULL,
        roi REAL NOT NULL,
        trade_time TEXT NOT NULL
      );
    `);
    this.seedKnownData();
  }

  private seedKnownData(): void {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM category_scores").get() as { c: number };
    if (row.c > 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO category_scores
       (category, score, win_count, total_count, total_pnl, recent_trend, last_updated, blocked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const [cat, data] of Object.entries(KNOWN_DATA)) {
      const winRate = data.total > 0 ? data.wins / data.total : 0.5;
      const avgRoi = data.total > 0 ? data.total_pnl / data.total : 0;
      const score = computeScore(winRate, avgRoi, data.total, data.recent_trend);
      const blocked = isBlocked(score) ? 1 : 0;
      stmt.run(cat, score, data.wins, data.total, data.total_pnl, data.recent_trend, now, blocked);
    }
  }

  getScore(category: string): number {
    const row = this.load(category);
    return row?.score ?? 0;
  }

  getAllScores(): CategoryScoreRow[] {
    return this.db
      .prepare("SELECT * FROM category_scores ORDER BY score DESC")
      .all() as unknown as CategoryScoreRow[];
  }

  isBlocked(category: string): boolean {
    return isBlocked(this.getScore(category));
  }

  getMaxAllocationPct(category: string): number {
    return getAllocationPct(this.getScore(category));
  }

  updateScore(category: string, tradeWon: boolean, roi: number): number {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO category_trade_log (category, won, roi, trade_time) VALUES (?, ?, ?, ?)"
      )
      .run(category, tradeWon ? 1 : 0, roi, now);

    const existing = this.db
      .prepare("SELECT * FROM category_scores WHERE category = ?")
      .get(category) as unknown as CategoryScoreRow | undefined;
    const winCount = (existing?.win_count ?? 0) + (tradeWon ? 1 : 0);
    const totalCount = (existing?.total_count ?? 0) + 1;
    const totalPnl = (existing?.total_pnl ?? 0) + roi;
    const trend = this.computeRecentTrend(category);
    const winRate = totalCount > 0 ? winCount / totalCount : 0.5;
    const avgRoi = totalCount > 0 ? totalPnl / totalCount : 0;
    const score = totalCount < MIN_SAMPLES_FOR_SCORING ? 0 : computeScore(winRate, avgRoi, totalCount, trend);
    const blocked = isBlocked(score) ? 1 : 0;

    this.db
      .prepare(
        `INSERT OR REPLACE INTO category_scores
         (category, score, win_count, total_count, total_pnl, recent_trend, last_updated, blocked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(category, score, winCount, totalCount, totalPnl, trend, now, blocked);
    this.cache.delete(category);
    return score;
  }

  forceBlock(category: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO category_scores
         (category, score, win_count, total_count, total_pnl, recent_trend, last_updated, blocked)
         VALUES (?, 0, 0, 0, 0, 0, ?, 1)`
      )
      .run(category, now);
    this.db.prepare("UPDATE category_scores SET blocked = 1, last_updated = ? WHERE category = ?").run(now, category);
    this.cache.delete(category);
  }

  private load(category: string): CategoryScoreRow | null {
    const now = Date.now();
    const cached = this.cache.get(category);
    if (cached && now - cached.ts < this.cacheTtlMs) return cached.data;
    const row = this.db
      .prepare("SELECT * FROM category_scores WHERE category = ?")
      .get(category) as unknown as CategoryScoreRow | undefined;
    if (!row) return null;
    this.cache.set(category, { data: row, ts: now });
    return row;
  }

  private computeRecentTrend(category: string, n = 10): number {
    const rows = this.db
      .prepare("SELECT won, roi FROM category_trade_log WHERE category = ? ORDER BY id DESC LIMIT ?")
      .all(category, n) as unknown as Array<{ won: number; roi: number }>;
    if (rows.length === 0) return 0;
    let weightedSum = 0;
    let totalWeight = 0;
    rows.forEach((r, i) => {
      const weight = 1 / (i + 1);
      const signal = r.won ? 1 : -1;
      weightedSum += signal * weight;
      totalWeight += weight;
    });
    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  scoreLabel(score: number): string {
    if (score >= 80) return "STRONG";
    if (score >= 60) return "GOOD";
    if (score >= 40) return "WEAK";
    if (score >= BLOCK_THRESHOLD) return "POOR";
    return "BLOCKED";
  }

  formatScoresTable(scores: CategoryScoreRow[]): string {
    const lines = [
      "=".repeat(70),
      "  CATEGORY SCORES",
      `  ${"Category".padEnd(18)} ${"Score".padStart(6)} ${"WR".padStart(6)} ${"ROI".padStart(8)} ${"Trades".padStart(7)} ${"Alloc".padStart(6)} Status`,
      `  ${"-".repeat(18)} ${"-".repeat(6)} ${"-".repeat(6)} ${"-".repeat(8)} ${"-".repeat(7)} ${"-".repeat(6)} ${"-".repeat(10)}`,
    ];
    for (const row of scores) {
      const wr = row.total_count > 0 ? `${Math.round((row.win_count / row.total_count) * 100)}%` : "n/a";
      const avgRoi = row.total_count > 0 ? `${((row.total_pnl / row.total_count) * 100).toFixed(1)}%` : "n/a";
      const alloc = `${(getAllocationPct(row.score) * 100).toFixed(0)}%`;
      lines.push(
        `  ${row.category.padEnd(18)} ${row.score.toFixed(1).padStart(6)} ${wr.padStart(6)} ${avgRoi.padStart(8)} ${String(row.total_count).padStart(7)} ${alloc.padStart(6)}  ${this.scoreLabel(row.score)}`
      );
    }
    lines.push("=".repeat(70));
    return lines.join("\n");
  }

  close(): void {
    this.db.close();
  }
}

export function inferCategory(ticker: string, title = ""): string {
  const t = ticker.toUpperCase();
  const l = title.toLowerCase();
  const startsAny = (prefixes: string[]): boolean => prefixes.some((p) => t.startsWith(p));
  const includesAny = (arr: string[], str: string): boolean => arr.some((p) => str.includes(p));

  if (
    startsAny([
      "KXNCAAB",
      "KXNCAAM",
      "NCAAB",
      "NCAAM",
      "KXBIG10",
      "KXBIG12",
      "KXACC",
      "KXSEC",
      "KXAAC",
      "KXBIGEAST",
    ])
  )
    return "NCAAB";
  if (startsAny(["KXNBA", "NBA"])) return "NBA";
  if (startsAny(["KXNFL", "NFL"])) return "NFL";
  if (startsAny(["KXNHL", "NHL"])) return "NHL";
  if (startsAny(["KXMLB", "MLB"])) return "MLB";
  if (startsAny(["KXUFC", "UFC"])) return "UFC";
  if (startsAny(["KXPGA", "PGA"])) return "GOLF";

  if (includesAny(["CPI", "INFLATION"], t)) return "CPI";
  if (includesAny(["FED", "FOMC", "RATE"], t)) return "FED";
  if (includesAny(["GDP", "JOBS", "NFP", "UNEMPLOYMENT", "PCE"], t)) return "ECON_MACRO";
  if (includesAny(["federal reserve", "interest rate", "fomc"], l)) return "FED";
  if (includesAny(["cpi", "inflation", "consumer price"], l)) return "CPI";
  if (includesAny(["gdp", "nonfarm", "unemployment", "jobs report"], l)) return "ECON_MACRO";

  if (includesAny(["PRES", "SENATE", "HOUSE", "ELECT", "TRUMP", "BIDEN"], t)) return "POLITICS";
  if (includesAny(["election", "president", "senate", "congress"], l)) return "POLITICS";
  if (includesAny(["BTC", "ETH", "CRYPTO", "SOL"], t)) return "CRYPTO";
  if (includesAny(["SPX", "SP500", "NASDAQ", "DOW"], t)) return "MARKETS";
  if (includesAny(["TEMP", "SNOW", "RAIN", "WEATHER"], t)) return "WEATHER";
  if (includesAny(["OSCAR", "GRAMMY", "AWARD", "MOVIE", "ALBUM", "SONG"], t)) return "ENTERTAINMENT";
  return "OTHER";
}

void logger;
