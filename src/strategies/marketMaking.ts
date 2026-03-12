import { v4 as uuidv4 } from "uuid";
import type { KalshiClient } from "../clients/kalshiClient.js";
import type { DatabaseManager, Market } from "../utils/database.js";
import { getLogger } from "../utils/logger.js";
import { settings } from "../config/settings.js";

const logger = getLogger("marketMaking");

export interface MarketMakingOpportunity {
  ticker: string;
  midPrice: number;
  spread: number;
  volume: number;
  bidPriceCents: number;
  askPriceCents: number;
  quantity: number;
  expectedProfit: number;
}

export interface MarketMakingResult {
  ordersPlaced: number;
  exposure: number;
  expectedProfit: number;
  opportunities: MarketMakingOpportunity[];
}

export class AdvancedMarketMaker {
  constructor(
    private client: KalshiClient,
    private db: DatabaseManager,
    public maxInventoryRisk = settings.maxInventoryRisk
  ) {}

  scanOpportunities(markets: Market[], capital: number): MarketMakingOpportunity[] {
    const opps: MarketMakingOpportunity[] = [];
    const spreadMin = settings.minSpreadForMaking;
    const volumeMin = settings.minVolumeForMarketMaking;
    for (const m of markets) {
      if (m.volume < volumeMin) continue;
      const mid = (m.yes_price + (1 - m.no_price)) / 2;
      const spread = Math.abs(m.yes_price - (1 - m.no_price));
      if (spread < spreadMin) continue;
      const bidCents = Math.max(1, Math.round((mid - spread / 2) * 100));
      const askCents = Math.min(99, Math.round((mid + spread / 2) * 100));
      const capPerOrder = capital * 0.05;
      const qty = Math.max(1, Math.floor(capPerOrder / (bidCents / 100)));
      const expectedProfit = (askCents - bidCents) * qty * 0.01 * 0.5;
      opps.push({
        ticker: m.market_id,
        midPrice: mid,
        spread,
        volume: m.volume,
        bidPriceCents: bidCents,
        askPriceCents: askCents,
        quantity: qty,
        expectedProfit,
      });
    }
    opps.sort((a, b) => b.expectedProfit - a.expectedProfit);
    return opps.slice(0, 20);
  }

  async placeOrders(opps: MarketMakingOpportunity[], dryRun: boolean): Promise<MarketMakingResult> {
    const result: MarketMakingResult = {
      ordersPlaced: 0,
      exposure: 0,
      expectedProfit: 0,
      opportunities: opps,
    };
    for (const o of opps) {
      if (dryRun) {
        logger.info({ ticker: o.ticker, bid: o.bidPriceCents, ask: o.askPriceCents }, "DRY RUN MM");
        result.ordersPlaced++;
        result.exposure += (o.bidPriceCents / 100) * o.quantity;
        result.expectedProfit += o.expectedProfit;
        continue;
      }
      try {
        await this.client.placeOrder({
          ticker: o.ticker,
          clientOrderId: uuidv4(),
          side: "yes",
          action: "buy",
          count: o.quantity,
          type: "limit",
          yesPrice: o.bidPriceCents,
        });
        await this.client.placeOrder({
          ticker: o.ticker,
          clientOrderId: uuidv4(),
          side: "yes",
          action: "sell",
          count: o.quantity,
          type: "limit",
          yesPrice: o.askPriceCents,
        });
        result.ordersPlaced += 2;
        result.exposure += (o.bidPriceCents / 100) * o.quantity;
        result.expectedProfit += o.expectedProfit;
      } catch (e) {
        logger.error({ ticker: o.ticker, err: (e as Error).message }, "MM order failed");
      }
    }
    return result;
  }
}

export async function runMarketMakingStrategy(
  db: DatabaseManager,
  client: KalshiClient,
  capital: number,
  dryRun: boolean
): Promise<MarketMakingResult> {
  const markets = db.getEligibleMarkets(settings.minVolumeForMarketMaking, 90);
  const mm = new AdvancedMarketMaker(client, db);
  const opps = mm.scanOpportunities(markets, capital);
  return mm.placeOrders(opps, dryRun);
}
