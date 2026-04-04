import type { DatabaseManager, Position } from "../utils/database.js";
import type { KalshiClient } from "../clients/kalshiClient.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("track");

export interface PositionStatus {
  position: Position;
  currentPrice: number;
  unrealizedPnl: number;
  shouldExit: boolean;
  exitReason?: string;
}

async function currentSideMidPrice(client: KalshiClient, ticker: string, side: "YES" | "NO"): Promise<number> {
  try {
    const m = await client.getMarket(ticker);
    const market = (m.market ?? m) as Record<string, unknown>;
    const yesBid = Number(market.yes_bid ?? 0) / 100;
    const yesAsk = Number(market.yes_ask ?? 0) / 100;
    const noBid = Number(market.no_bid ?? 0) / 100;
    const noAsk = Number(market.no_ask ?? 0) / 100;
    return side === "YES" ? (yesBid + yesAsk) / 2 : (noBid + noAsk) / 2;
  } catch (e) {
    logger.warn({ err: (e as Error).message, ticker }, "Failed to fetch market");
    return NaN;
  }
}

export async function trackOpenPositions(
  db: DatabaseManager,
  client: KalshiClient
): Promise<PositionStatus[]> {
  const open = db.getOpenPositions();
  const results: PositionStatus[] = [];
  for (const p of open) {
    const price = await currentSideMidPrice(client, p.market_id, p.side);
    if (!Number.isFinite(price)) continue;
    const unrealizedPnl = (price - p.entry_price) * p.quantity;
    let shouldExit = false;
    let exitReason: string | undefined;

    if (p.stop_loss_price !== null && p.stop_loss_price !== undefined && price <= p.stop_loss_price) {
      shouldExit = true;
      exitReason = "stop_loss";
    } else if (p.take_profit_price !== null && p.take_profit_price !== undefined && price >= p.take_profit_price) {
      shouldExit = true;
      exitReason = "take_profit";
    } else if (p.max_hold_hours) {
      const ageHours = (Date.now() - new Date(p.timestamp).getTime()) / 3_600_000;
      if (ageHours >= p.max_hold_hours) {
        shouldExit = true;
        exitReason = "max_hold";
      }
    }

    results.push({ position: p, currentPrice: price, unrealizedPnl, shouldExit, exitReason });
  }
  return results;
}

export async function closePosition(
  db: DatabaseManager,
  client: KalshiClient,
  position: Position,
  price: number
): Promise<void> {
  if (!position.id) return;
  try {
    if (position.live) {
      await client.placeOrder({
        ticker: position.market_id,
        clientOrderId: crypto.randomUUID(),
        side: position.side.toLowerCase() as "yes" | "no",
        action: "sell",
        count: position.quantity,
        type: "market",
      });
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message, ticker: position.market_id }, "Live sell failed, closing in DB");
  }
  const pnl = (price - position.entry_price) * position.quantity;
  db.closePosition(position.id, price, pnl, new Date().toISOString());
  logger.info({ positionId: position.id, pnl }, "Position closed");
}
