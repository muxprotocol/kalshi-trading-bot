import { v4 as uuidv4 } from "uuid";
import { getLogger } from "../utils/logger.js";
import type { KalshiClient } from "../clients/kalshiClient.js";

const logger = getLogger("safeCompounder");

export const SKIP_PREFIXES = [
  "KXNBA", "KXNFL", "KXNHL", "KXMLB", "KXUFC", "KXPGA", "KXATP",
  "KXEPL", "KXUCL", "KXLIGA", "KXSERIE", "KXBUNDES", "KXLIGUE",
  "KXWC", "KXMARMAD", "KXMAKEMARMAD", "KXWMARMAD", "KXRT-",
  "KXPERFORM", "KXACTOR", "KXBOND-", "KXOSCAR", "KXBAFTA", "KXSAG",
  "KXSNL", "KXSURVIVOR", "KXTRAITORS", "KXDAILY",
  "KXALBUM", "KXSONG", "KX1SONG", "KX20SONG", "KXTOUR-",
  "KXFEATURE", "KXGTA", "KXBIG10", "KXBIG12", "KXACC", "KXSEC",
  "KXAAC", "KXBIGEAST", "KXNCAAM", "KXCOACH", "KXMV",
  "KXCHESS", "KXBELGIAN", "KXEFL", "KXSUPER", "KXLAMIN",
  "KXWHATSON", "KXWOWHOCKEY",
  "KXMENTION", "KXTMENTION", "KXTRUMPMENTION", "KXTRUMPSAY",
  "KXSPEECH", "KXTSPEECH", "KXADDRESS",
];

export const MIN_VOLUME = 10;
export const MIN_NO_ASK = 0.8;
export const MIN_EDGE = 0.03;
export const MAX_POSITION_PCT = 0.1;
export const USE_KELLY = true;
export const MIN_CONFIDENCE = 0.4;

export function shouldSkip(ticker: string): boolean {
  const upper = ticker.toUpperCase();
  return SKIP_PREFIXES.some((p) => upper.startsWith(p.toUpperCase()));
}

export function estimateTrueNoProb(yesLast: number, hoursToExpiry: number): number {
  if (yesLast <= 0) return 0.999;
  if (yesLast >= 1) return 0.001;
  const baseProb = 1 - yesLast;
  let timeBoost = 0;
  if (hoursToExpiry <= 24) timeBoost = 0.03;
  else if (hoursToExpiry <= 72) timeBoost = 0.02;
  else if (hoursToExpiry <= 168) timeBoost = 0.01;
  return Math.max(0, Math.min(0.999, baseProb + timeBoost));
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

export interface CompounderOpportunity {
  ticker: string;
  title: string;
  yesLast: number;
  noAsk: number;
  trueNoProb: number;
  edge: number;
  hoursToExpiry: number;
  volume: number;
}

export interface CompounderStats {
  scanned: number;
  eligible: number;
  ordersPlaced: number;
}

export class SafeCompounder {
  constructor(
    private client: KalshiClient,
    public dryRun = true
  ) {}

  async run(): Promise<CompounderStats> {
    const stats: CompounderStats = { scanned: 0, eligible: 0, ordersPlaced: 0 };
    let balance = 0;
    try {
      const r = await this.client.getBalance();
      balance = Number(r.balance ?? 0) / 100;
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "Could not fetch balance");
    }
    if (balance <= 0 && !this.dryRun) {
      logger.warn("Zero balance; aborting");
      return stats;
    }

    let cursor: string | undefined;
    do {
      const resp = await this.client.getMarkets({ limit: 100, cursor, status: "open" });
      const markets = (resp.markets ?? []) as Record<string, unknown>[];
      for (const m of markets) {
        stats.scanned++;
        const opp = this.evaluate(m);
        if (!opp) continue;
        stats.eligible++;
        const ok = await this.placeOrder(opp, balance);
        if (ok) stats.ordersPlaced++;
      }
      cursor = typeof resp.cursor === "string" && resp.cursor ? resp.cursor : undefined;
    } while (cursor);

    logger.info(stats, "SafeCompounder complete");
    return stats;
  }

  private evaluate(market: Record<string, unknown>): CompounderOpportunity | null {
    const ticker = String(market.ticker ?? "");
    if (!ticker || shouldSkip(ticker)) return null;
    const volume = Number(market.volume ?? 0);
    if (volume < MIN_VOLUME) return null;
    const yesLast = Number((market as any).yes_bid_dollars ?? market.last_price ?? 0);
    const noAsk = Number((market as any).no_ask_dollars ?? (Number(market.no_ask ?? 0) / 100));
    if (noAsk < MIN_NO_ASK) return null;
    const expirationTs = Number(market.expiration_time ?? market.expiration_ts ?? 0);
    const expMs = String(market.expiration_time ?? "") ? Date.parse(String(market.expiration_time)) : expirationTs * 1000;
    const hoursToExpiry = Math.max(0, (expMs - Date.now()) / 3_600_000);
    const trueNoProb = estimateTrueNoProb(yesLast, hoursToExpiry);
    const edge = trueNoProb - noAsk;
    if (edge < MIN_EDGE) return null;
    return {
      ticker,
      title: String(market.title ?? ticker),
      yesLast,
      noAsk,
      trueNoProb,
      edge,
      hoursToExpiry,
      volume,
    };
  }

  private async placeOrder(opp: CompounderOpportunity, balance: number): Promise<boolean> {
    const maxPos = balance * MAX_POSITION_PCT;
    const kelly = USE_KELLY ? kellyFraction(opp.trueNoProb, opp.noAsk) : MAX_POSITION_PCT;
    const investAmount = Math.min(maxPos, balance * kelly);
    const limitPriceCents = Math.max(1, Math.round(opp.noAsk * 100) - 1);
    const quantity = Math.floor(investAmount / (limitPriceCents / 100));
    if (quantity <= 0) return false;

    if (this.dryRun) {
      logger.info({ ticker: opp.ticker, quantity, limitPriceCents, edge: opp.edge.toFixed(3) }, "DRY RUN: would place NO limit order");
      return true;
    }
    try {
      const resp = await this.client.placeOrder({
        ticker: opp.ticker,
        clientOrderId: uuidv4(),
        side: "no",
        action: "buy",
        count: quantity,
        type: "limit",
        noPrice: limitPriceCents,
      });
      logger.info({ ticker: opp.ticker, orderId: resp.order?.order_id }, "Order placed");
      return true;
    } catch (e) {
      logger.error({ ticker: opp.ticker, err: (e as Error).message }, "Order placement failed");
      return false;
    }
  }
}
