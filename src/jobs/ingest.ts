import type { KalshiClient } from "../clients/kalshiClient.js";
import type { DatabaseManager, Market } from "../utils/database.js";
import { settings } from "../config/settings.js";
import { getLogger } from "../utils/logger.js";
import { isTradeableMarket } from "../utils/marketPrices.js";

const logger = getLogger("ingest");

export interface IngestStats {
  fetched: number;
  upserted: number;
  skipped: number;
}

function toMarketRow(raw: Record<string, unknown>): Market | null {
  const ticker = String(raw.ticker ?? raw.market_id ?? "");
  if (!ticker) return null;
  if (!isTradeableMarket(raw)) return null;

  const hasDollars = "yes_bid_dollars" in raw;
  let yesPrice: number;
  let noPrice: number;
  if (hasDollars) {
    const yb = Number(raw.yes_bid_dollars ?? 0);
    const ya = Number(raw.yes_ask_dollars ?? 0);
    const nb = Number(raw.no_bid_dollars ?? 0);
    const na = Number(raw.no_ask_dollars ?? 0);
    yesPrice = (yb + ya) / 2;
    noPrice = (nb + na) / 2;
  } else {
    yesPrice = (Number(raw.yes_bid ?? 0) + Number(raw.yes_ask ?? 0)) / 200;
    noPrice = (Number(raw.no_bid ?? 0) + Number(raw.no_ask ?? 0)) / 200;
  }

  const expTime = raw.expiration_time ? Date.parse(String(raw.expiration_time)) / 1000 : Number(raw.expiration_ts ?? 0);
  return {
    market_id: ticker,
    title: String(raw.title ?? ticker),
    yes_price: yesPrice,
    no_price: noPrice,
    volume: Math.floor(Number(raw.volume ?? 0)),
    expiration_ts: Math.floor(expTime || 0),
    category: String(raw.category ?? ""),
    status: String(raw.status ?? "open"),
    last_updated: new Date().toISOString(),
  };
}

export async function runIngestion(
  db: DatabaseManager,
  client: KalshiClient,
  maxPages = 10
): Promise<IngestStats> {
  const stats: IngestStats = { fetched: 0, upserted: 0, skipped: 0 };
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const resp = await client.getMarkets({ limit: 1000, cursor, status: "open" });
    const markets = (resp.markets ?? []) as Record<string, unknown>[];
    stats.fetched += markets.length;
    const rows: Market[] = [];
    for (const m of markets) {
      const r = toMarketRow(m);
      if (r) rows.push(r);
      else stats.skipped++;
    }
    if (rows.length) {
      db.upsertMarkets(rows);
      stats.upserted += rows.length;
    }
    cursor = typeof resp.cursor === "string" && resp.cursor ? resp.cursor : undefined;
    if (!cursor) break;
  }
  logger.info(stats, "Ingestion complete");
  void settings;
  return stats;
}
