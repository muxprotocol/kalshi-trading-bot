import { settings } from "./config/settings.js";
import { getLogger } from "./utils/logger.js";
import { DatabaseManager } from "./utils/database.js";
import { KalshiClient } from "./clients/kalshiClient.js";
import { ModelRouter } from "./clients/modelRouter.js";
import { runIngestion } from "./jobs/ingest.js";
import { runTradingJob } from "./jobs/trade.js";
import { trackOpenPositions, closePosition } from "./jobs/track.js";
import { evaluatePerformance } from "./jobs/evaluate.js";
import { globalBus } from "./events/eventBus.js";

const logger = getLogger("beastModeBot");

export interface BotOptions {
  live?: boolean;
  dailyLimit?: number;
  ingestIntervalMs?: number;
  tradeIntervalMs?: number;
  trackIntervalMs?: number;
  evaluateIntervalMs?: number;
  maxIterations?: number;
  onIteration?: (ctx: { iter: number }) => void | Promise<void>;
}

export class BeastModeBot {
  db: DatabaseManager;
  client: KalshiClient;
  modelRouter: ModelRouter;
  running = false;
  private timers: NodeJS.Timeout[] = [];

  constructor(public opts: BotOptions = {}) {
    if (opts.live !== undefined) {
      settings.trading.liveTradingEnabled = opts.live;
      settings.trading.paperTradingMode = !opts.live;
    }
    if (opts.dailyLimit !== undefined) settings.trading.dailyAiCostLimit = opts.dailyLimit;
    this.db = new DatabaseManager();
    this.client = new KalshiClient();
    this.modelRouter = new ModelRouter({ dbManager: this.db });
  }

  async initialize(): Promise<void> {
    settings.validate();
    await this.db.initialize();
    logger.info(
      {
        live: settings.trading.liveTradingEnabled,
        dailyLimit: settings.trading.dailyAiCostLimit,
        beastMode: settings.beastModeEnabled,
      },
      "BeastModeBot initialized"
    );
  }

  async checkDailyLimits(): Promise<boolean> {
    return this.modelRouter.checkDailyLimits();
  }

  async runOnce(): Promise<void> {
    logger.info("=== ITERATION START ===");
    try {
      const ingested = await runIngestion(this.db, this.client);
      globalBus.publish({ type: "market_ingested", count: ingested.upserted });
    } catch (e) {
      logger.error({ err: (e as Error).message }, "Ingestion failed");
    }

    const canProceed = await this.checkDailyLimits();
    if (!canProceed) {
      logger.warn("Daily AI cost limit reached; skipping trade + track cycle");
      globalBus.publish({
        type: "daily_limit_reached",
        cost: this.modelRouter.dailyTracker.totalCost,
        limit: this.modelRouter.dailyTracker.dailyLimit,
      });
      return;
    }

    try {
      await runTradingJob(this.db, this.client, this.modelRouter);
    } catch (e) {
      logger.error({ err: (e as Error).message }, "Trading job failed");
    }

    try {
      const statuses = await trackOpenPositions(this.db, this.client);
      for (const s of statuses) {
        if (s.shouldExit) {
          await closePosition(this.db, this.client, s.position, s.currentPrice);
          globalBus.publish({
            type: "position_closed",
            id: s.position.id ?? -1,
            pnl: s.unrealizedPnl,
          });
        }
      }
    } catch (e) {
      logger.error({ err: (e as Error).message }, "Tracking failed");
    }

    try {
      const perf = evaluatePerformance(this.db);
      logger.info(
        { trades: perf.totalTrades, winRate: +perf.winRate.toFixed(3), pnl: +perf.totalPnl.toFixed(2) },
        "Performance snapshot"
      );
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "Evaluate failed");
    }

    logger.info("=== ITERATION END ===");
  }

  async run(): Promise<void> {
    await this.initialize();
    this.running = true;
    const maxIter = this.opts.maxIterations ?? Infinity;
    const intervalMs = this.opts.tradeIntervalMs ?? settings.trading.runIntervalMinutes * 60 * 1000;
    let iter = 0;
    while (this.running && iter < maxIter) {
      iter++;
      await this.runOnce();
      if (this.opts.onIteration) await this.opts.onIteration({ iter });
      if (iter >= maxIter) break;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    await this.shutdown();
  }

  async shutdown(): Promise<void> {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    await this.modelRouter.close().catch(() => {});
    await this.client.close().catch(() => {});
    this.db.close();
    logger.info("BeastModeBot shut down");
  }
}
