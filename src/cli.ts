#!/usr/bin/env node
import { settings } from "./config/settings.js";
import { getLogger, setupLogging } from "./utils/logger.js";
import { BeastModeBot } from "./beastModeBot.js";
import { DatabaseManager } from "./utils/database.js";
import { KalshiClient } from "./clients/kalshiClient.js";
import { CategoryScorer } from "./strategies/categoryScorer.js";
import { SafeCompounder } from "./strategies/safeCompounder.js";
import { evaluatePerformance } from "./jobs/evaluate.js";
import { renderDashboard } from "./paper/dashboard.js";

const logger = getLogger("cli");

interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return { command, flags };
}

function printHelp(): void {
  console.log(`
Kalshi AI Trading Bot (TypeScript)

Usage: kalshi-bot <command> [options]

Commands:
  run                     Run the Beast Mode trading loop
    --live                Enable live trading (default: paper)
    --daily-limit <n>     Daily AI cost limit USD (default: 10)
    --iterations <n>      Max iterations (default: infinite)

  dashboard               Print paper trading dashboard
  status                  Print current portfolio status
  scores                  Print category scores
  history [--limit n]     Print recent trades
  safe-compounder         Run NO-side edge compounder (dry-run by default)
    --live                Place real orders

  health                  Print health diagnostics
  help                    Show this message

Environment:
  KALSHI_API_KEY              (required)
  KALSHI_PRIVATE_KEY_PATH     path to RSA private key PEM
  OPENROUTER_API_KEY          for AI models
  LIVE_TRADING_ENABLED=true   enables live trading
  DAILY_AI_COST_LIMIT         default 10 USD
  LOG_LEVEL                   info | debug | warn | error
`);
}

async function cmdRun(flags: ParsedArgs["flags"]): Promise<void> {
  const live = Boolean(flags.live);
  const dailyLimit = flags["daily-limit"] ? Number(flags["daily-limit"]) : undefined;
  const maxIter = flags.iterations ? Number(flags.iterations) : undefined;
  const bot = new BeastModeBot({ live, dailyLimit, maxIterations: maxIter });
  const handle = (): void => {
    logger.info("Shutdown signal received");
    bot.shutdown().catch(() => {});
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", handle);
  process.on("SIGTERM", handle);
  await bot.run();
}

async function cmdDashboard(): Promise<void> {
  const db = new DatabaseManager();
  await db.initialize();
  console.log(renderDashboard(db));
  db.close();
}

async function cmdStatus(): Promise<void> {
  const db = new DatabaseManager();
  await db.initialize();
  const client = new KalshiClient();
  const balanceResp = await client.getBalance().catch(() => null);
  const balance = balanceResp ? Number(balanceResp.balance ?? 0) / 100 : null;
  const open = db.getOpenPositions();
  console.log(`Balance: ${balance !== null ? `$${balance.toFixed(2)}` : "unavailable"}`);
  console.log(`Open positions: ${open.length}`);
  for (const p of open.slice(0, 20)) {
    console.log(
      `  ${p.market_id.padEnd(24)} ${p.side.padEnd(3)} qty=${p.quantity} @ ${p.entry_price.toFixed(2)} live=${p.live ? "Y" : "N"}`
    );
  }
  db.close();
}

async function cmdScores(): Promise<void> {
  const scorer = new CategoryScorer();
  scorer.initialize();
  const rows = scorer.getAllScores();
  console.log(scorer.formatScoresTable(rows));
  scorer.close();
}

async function cmdHistory(flags: ParsedArgs["flags"]): Promise<void> {
  const limit = flags.limit ? Number(flags.limit) : 50;
  const db = new DatabaseManager();
  await db.initialize();
  const perf = evaluatePerformance(db);
  const logs = db.getTradeLogs(limit);
  console.log(`Total trades: ${perf.totalTrades} | WR: ${(perf.winRate * 100).toFixed(1)}% | PnL: $${perf.totalPnl.toFixed(2)}`);
  for (const l of logs) {
    console.log(
      `  ${l.exit_timestamp} ${l.market_id.padEnd(20)} ${l.side.padEnd(3)} qty=${l.quantity} entry=${l.entry_price.toFixed(2)} exit=${l.exit_price.toFixed(2)} pnl=$${l.pnl.toFixed(2)}`
    );
  }
  db.close();
}

async function cmdSafeCompounder(flags: ParsedArgs["flags"]): Promise<void> {
  const live = Boolean(flags.live);
  const client = new KalshiClient();
  const strategy = new SafeCompounder(client, !live);
  const stats = await strategy.run();
  console.log(`SafeCompounder: scanned=${stats.scanned} eligible=${stats.eligible} orders=${stats.ordersPlaced}`);
}

async function cmdHealth(): Promise<void> {
  console.log(`kalshi API key: ${settings.api.kalshiApiKey ? "set" : "MISSING"}`);
  console.log(`openrouter API key: ${settings.api.openrouterApiKey ? "set" : "MISSING"}`);
  console.log(`live trading: ${settings.trading.liveTradingEnabled}`);
  console.log(`daily AI cost limit: $${settings.trading.dailyAiCostLimit}`);
  try {
    const client = new KalshiClient();
    const b = await client.getBalance();
    console.log(`Kalshi balance: $${(Number(b.balance ?? 0) / 100).toFixed(2)}`);
  } catch (e) {
    console.log(`Kalshi balance: ERROR — ${(e as Error).message}`);
  }
}

async function main(): Promise<void> {
  setupLogging();
  const { command, flags } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "run":
      await cmdRun(flags);
      break;
    case "dashboard":
      await cmdDashboard();
      break;
    case "status":
      await cmdStatus();
      break;
    case "scores":
      await cmdScores();
      break;
    case "history":
      await cmdHistory(flags);
      break;
    case "safe-compounder":
      await cmdSafeCompounder(flags);
      break;
    case "health":
      await cmdHealth();
      break;
    case "help":
    default:
      printHelp();
      break;
  }
}

main().catch((err: unknown) => {
  logger.error({ err: (err as Error).message, stack: (err as Error).stack }, "Fatal error");
  process.exit(1);
});
