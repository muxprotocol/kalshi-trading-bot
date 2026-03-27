import { v4 as uuidv4 } from "uuid";
import type { DatabaseManager, Position } from "../utils/database.js";
import type { KalshiClient } from "../clients/kalshiClient.js";
import { settings } from "../config/settings.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("execute");

export interface ExecuteResult {
  success: boolean;
  orderId?: string;
  positionId?: number;
  reason?: string;
}

export async function executePosition(
  position: Position,
  db: DatabaseManager,
  client: KalshiClient
): Promise<ExecuteResult> {
  const live = settings.trading.liveTradingEnabled && !settings.trading.paperTradingMode;
  if (!live) {
    position.status = "open";
    position.live = false;
    const id = db.insertPosition(position);
    logger.info({ id, ticker: position.market_id, side: position.side }, "Paper order recorded");
    return { success: true, positionId: id, reason: "paper" };
  }

  const limitCents = Math.max(1, Math.min(99, Math.round(position.entry_price * 100)));
  const params = {
    ticker: position.market_id,
    clientOrderId: uuidv4(),
    side: position.side.toLowerCase() as "yes" | "no",
    action: "buy" as const,
    count: position.quantity,
    type: "limit" as const,
    ...(position.side === "YES" ? { yesPrice: limitCents } : { noPrice: limitCents }),
  };

  try {
    const resp = await client.placeOrder(params);
    const orderId = String(resp.order?.order_id ?? "unknown");
    position.status = "open";
    position.live = true;
    const id = db.insertPosition(position);
    logger.info({ id, orderId, ticker: position.market_id }, "Live order placed");
    return { success: true, orderId, positionId: id };
  } catch (e) {
    logger.error({ err: (e as Error).message, ticker: position.market_id }, "Order failed");
    return { success: false, reason: (e as Error).message };
  }
}
