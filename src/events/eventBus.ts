import { EventEmitter } from "node:events";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("eventBus");

export type TradingEvent =
  | { type: "market_ingested"; count: number }
  | { type: "decision_made"; ticker: string; action: string; confidence: number }
  | { type: "position_opened"; id: number; ticker: string; side: string; quantity: number }
  | { type: "position_closed"; id: number; pnl: number }
  | { type: "daily_limit_reached"; cost: number; limit: number }
  | { type: "error"; source: string; message: string };

export class TradingEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  publish(event: TradingEvent): void {
    logger.debug(event, "event published");
    this.emit(event.type, event);
    this.emit("*", event);
  }
}

export const globalBus = new TradingEventBus();
