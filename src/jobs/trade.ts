import type { DatabaseManager } from "../utils/database.js";
import type { KalshiClient } from "../clients/kalshiClient.js";
import type { ModelRouter } from "../clients/modelRouter.js";
import { settings } from "../config/settings.js";
import {
  runUnifiedTradingSystem,
  defaultTradingSystemConfig,
  type TradingSystemResults,
} from "../strategies/unifiedTradingSystem.js";
import { getLogger } from "../utils/logger.js";
import { makeDecisionForMarket } from "./decide.js";
import { executePosition } from "./execute.js";

const logger = getLogger("trade");

export async function runTradingJob(
  db: DatabaseManager,
  client: KalshiClient,
  modelRouter: ModelRouter
): Promise<TradingSystemResults | { mode: string; count: number }> {
  if (settings.beastModeEnabled) {
    try {
      const cfg = defaultTradingSystemConfig();
      const res = await runUnifiedTradingSystem(db, client, modelRouter, cfg);
      logger.info(res, "Unified trading system result");
      return res;
    } catch (e) {
      logger.error({ err: (e as Error).message }, "Unified system failed, falling back");
      if (!settings.fallbackToLegacy) throw e;
    }
  }

  const markets = db.getEligibleMarkets(settings.trading.minVolume, settings.trading.maxTimeToExpiryDays).slice(0, 5);
  let count = 0;
  for (const m of markets) {
    try {
      const position = await makeDecisionForMarket(m, db, modelRouter, client);
      if (position) {
        const r = await executePosition(position, db, client);
        if (r.success) count++;
      }
    } catch (e) {
      logger.warn({ ticker: m.market_id, err: (e as Error).message }, "Legacy decide failed");
    }
  }
  return { mode: "legacy", count };
}
