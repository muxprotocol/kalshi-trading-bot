import { getLogger } from "../utils/logger.js";
import type { KalshiClient } from "../clients/kalshiClient.js";
import type { DatabaseManager, Market } from "../utils/database.js";
import { settings } from "../config/settings.js";

const logger = getLogger("quickFlip");

/**
 * DEPRECATED STRATEGY — disabled by default.
 * Original: 0% WR, -$208 in 12 trades.
 * Kept for parity with the Python codebase but wired as a no-op.
 */
export class QuickFlipScalpingStrategy {
  constructor(
    private client: KalshiClient,
    private db: DatabaseManager,
    public enabled = false
  ) {}

  async run(): Promise<{ enabled: boolean; ordersPlaced: number }> {
    if (!this.enabled) {
      logger.info("Quick flip scalping disabled (deprecated)");
      return { enabled: false, ordersPlaced: 0 };
    }
    const markets = this.db.getEligibleMarkets(settings.minVolumeForAnalysis, 1);
    logger.info({ markets: markets.length }, "Quick flip scanning (no-op)");
    return { enabled: true, ordersPlaced: 0 };
  }

  evaluate(market: Market): boolean {
    void market;
    return false;
  }
}
