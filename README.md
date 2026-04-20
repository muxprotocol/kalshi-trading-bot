<div align="center">

# Kalshi AI Trading Bot

### Beast-Mode, multi-model AI that trades Kalshi prediction markets while you sleep.

*Five elite LLMs. One ruthless trading engine. Zero emotional decisions.*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.5%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Kalshi](https://img.shields.io/badge/Kalshi-API-00C48C)](https://kalshi.com/)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-Multi--LLM-FF6B6B)](https://openrouter.ai/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](#license)
[![Paper Trading](https://img.shields.io/badge/Paper%20Trading-Built--in-brightgreen)](#safety-first)
[![Tests](https://img.shields.io/badge/tests-vitest-6E9F18?logo=vitest&logoColor=white)](#tests)

```
   ╔══════════════════════════════════════════════════════════╗
   ║   Claude 4.5  ·  GPT-5.4  ·  Gemini 3.1  ·  Grok  ·  DS  ║
   ║           → Ensemble Consensus → Kelly Sizing →          ║
   ║             Risk-Managed Execution → Profit              ║
   ╚══════════════════════════════════════════════════════════╝
```

</div>

---

## Why This Bot Is Different

Most "AI trading bots" are a single LLM prompted to gamble. **This one is a trading firm in a terminal.**

It runs **five specialized AI agents** in parallel — a forecaster, a news analyst, a bull researcher, a bear researcher, and a risk manager — then lets them **debate**, aggregates their probabilities with **confidence-weighted consensus**, and only pulls the trigger when disagreement is low and the edge is real. Every decision is logged, every model's calibration is tracked, and every dollar is sized with the **Kelly Criterion** inside hard position and daily-loss limits.

> If that sounds like overkill for a prediction market bot — that's the point.

---

## Feature Highlights

| Category | What You Get |
|---|---|
| **Multi-Model Ensemble** | Claude Sonnet 4.5 · GPT-5.4 · Gemini 3.1 Pro · DeepSeek V3.2 · Grok 4.1 — all orchestrated via OpenRouter with per-model health tracking and automatic failover |
| **Agent Debate** | Bull vs. Bear researchers argue the thesis; a Risk Manager has veto power. Disagreement above threshold automatically *penalizes confidence*. |
| **Kelly Sizing** | Fractional Kelly (default 25%) position sizing with hard caps on single-position, daily loss, and total open positions |
| **Safe Compounder** | NO-side edge compounding strategy for asymmetric, high-probability trades — runs in dry-run by default |
| **Market Making** | Optional spread-capture mode with inventory risk limits and automatic order refresh |
| **Quick-Flip Scalping** | Short-horizon opportunistic strategy for high-liquidity markets |
| **Category Scoring** | Continuously learns which market categories (sports, economics, politics, etc.) your bot is actually good at — and leans in |
| **News & Sentiment** | RSS aggregation from Reuters, NYT, BBC + LLM-scored sentiment & relevance feeding every decision |
| **Real-Time Data** | WebSocket streaming from Kalshi keeps market prices fresh without hammering the REST API |
| **Hard Cost Guardrails** | Daily AI spend cap (default **$10/day**) enforced at the router level — the bot literally *refuses* to call an LLM when the budget is out |
| **Paper Trading First** | Full simulation mode with its own tracker and dashboard so you can battle-test strategies risk-free |
| **Rich CLI** | `run`, `dashboard`, `status`, `scores`, `history`, `safe-compounder`, `health` — everything you need, nothing you don't |
| **Type-Safe Core** | Strict TypeScript + Zod validation + Vitest tests on the parts that actually matter (ensemble, portfolio optimization, JSON repair, DB, category scoring) |

---

## The Agent Architecture

```
                     ┌────────────────────────────────┐
                     │     KALSHI MARKET + NEWS       │
                     │  (REST + WebSocket + RSS)      │
                     └──────────────┬─────────────────┘
                                    │
                   ┌────────────────┼────────────────┐
                   ▼                ▼                ▼
            ┌────────────┐  ┌────────────┐  ┌────────────┐
            │ Forecaster │  │News Analyst│  │Risk Manager│
            │  (0.30 w)  │  │  (0.20 w)  │  │  (0.15 w)  │
            └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
                  │   ┌───────────┼───────────┐   │
                  │   ▼           │           ▼   │
                  │ ┌──────────┐  │  ┌──────────┐ │
                  │ │   Bull   │◄─┼─►│   Bear   │ │
                  │ │Researcher│  │  │Researcher│ │
                  │ │ (0.20 w) │  │  │ (0.15 w) │ │
                  │ └────┬─────┘  │  └────┬─────┘ │
                  │      └─── DEBATE ─────┘       │
                  └───────────────┬───────────────┘
                                  ▼
                    ┌──────────────────────────┐
                    │   ENSEMBLE CONSENSUS     │
                    │  weighted · calibrated   │
                    │   disagreement-penalized │
                    └────────────┬─────────────┘
                                 ▼
              ┌──────────────────────────────────────┐
              │  Kelly Sizing  →  Position Limits    │
              │  Stop-Loss     →  Daily Loss Cap     │
              └────────────────────┬─────────────────┘
                                   ▼
                          ┌────────────────┐
                          │  Paper or Live │
                          │   Execution    │
                          └────────────────┘
```

Every iteration: **ingest → analyze → decide → execute → track → evaluate.** Every model call is metered. Every trade is logged to SQLite. Every position has a dynamic exit.

---

## Quick Start

### 1. Requirements

- **Node.js 22.5+** (uses native `--experimental-sqlite`)
- A **Kalshi API key** + RSA private key
- An **OpenRouter API key** (one key, five models)

### 2. Install

```bash
clone the repo
cd kalshi-ai-trading-bot
npm install
```

### 3. Configure

Copy `env.template` → `.env` and fill in:

```ini
KALSHI_API_KEY=your_kalshi_api_key_here
KALSHI_PRIVATE_KEY_PATH=./kalshi_private_key.pem
OPENROUTER_API_KEY=your_openrouter_api_key_here

LIVE_TRADING_ENABLED=false     # START HERE. Paper first, always.
DAILY_AI_COST_LIMIT=10         # hard cap in USD
LOG_LEVEL=info
```

### 4. Verify

```bash
npm run dev -- health
```

You'll see your Kalshi balance, API key status, and daily budget. If anything is red, fix it before moving on.

### 5. Launch Beast Mode (paper)

```bash
npm run dev -- run --iterations 10
```

Watch the five agents do their thing. When you're ready for real money:

```bash
npm run dev -- run --live --daily-limit 5
```

> **Heads up:** `--live` places real orders with real money. Review the safety section below first.

---

## CLI Reference

```
kalshi-bot <command> [options]

  run                     Run the Beast Mode trading loop
    --live                Enable live trading (default: paper)
    --daily-limit <n>     Daily AI cost limit USD (default: 10)
    --iterations <n>      Max iterations (default: infinite)

  dashboard               Print paper trading dashboard
  status                  Print current portfolio + open positions
  scores                  Print learned category performance scores
  history [--limit n]     Print recent closed trades with PnL
  safe-compounder         Run NO-side edge compounder (dry-run by default)
    --live                Place real orders
  health                  Print health diagnostics
  help                    Show the full menu
```

---

## Safety First

This bot can lose you money. It's designed to minimize that — but no model is perfect. The project ships with **layers of defense**:

- **Paper trading by default.** `LIVE_TRADING_ENABLED=false` is the default. `--live` is opt-in, per invocation.
- **Hard daily AI spend cap.** The `ModelRouter` physically cannot exceed `DAILY_AI_COST_LIMIT`. When it's out, the bot skips trading rather than flying blind.
- **Position & loss limits.** Max 3% of balance per position, max 10% daily loss, max 10 open positions — all configurable in `src/config/settings.ts`.
- **Ensemble consensus requirement.** At least 3 models must agree before a trade is considered, and high disagreement penalizes confidence automatically.
- **Minimum confidence threshold** (default `0.45`) prevents coin-flip trades from ever hitting the wire.
- **Minimum volume & max-expiry filters** keep the bot out of illiquid or stale markets.
- **Stop-loss & dynamic exits** on every position, with a max-hold-time sanity timer.
- **Full audit trail.** Every decision, every model output, every trade — all persisted in SQLite (`trading.db`) and JSONL logs.

> **The project is provided as-is for educational and research purposes. Trade at your own risk. Past paper-trading performance is not indicative of anything.**

---

## Tech Stack

- **Runtime:** Node.js 22.5+ with native SQLite
- **Language:** TypeScript 5.6 (strict)
- **LLM Gateway:** [OpenRouter](https://openrouter.ai/) — one key, five frontier models
- **Exchange:** [Kalshi](https://kalshi.com/) REST + WebSocket
- **Validation:** [Zod](https://zod.dev/)
- **Logging:** [Pino](https://getpino.io/) (+ pretty in dev)
- **Testing:** [Vitest](https://vitest.dev/)
- **News:** `rss-parser` against Reuters, NYT, BBC (configurable)

---

## Project Layout

```
src/
├── agents/          Five specialized AI agents + ensemble runner + debate
├── clients/         KalshiClient, KalshiWS, OpenRouterClient, ModelRouter
├── config/          All tunables, with typed Settings and validation
├── data/            News aggregation + sentiment analysis
├── events/          In-process event bus
├── jobs/            ingest · decide · trade · track · evaluate · execute
├── paper/           Paper-trading tracker + terminal dashboard
├── strategies/      Safe Compounder · Market Making · Quick-Flip · Portfolio
│                    · Category Scorer · Portfolio Enforcer · Unified System
├── utils/           DB · logger · Kelly · limits · stop-loss · JSON repair
├── beastModeBot.ts  Main orchestration loop
└── cli.ts           Command-line interface

tests/               Vitest suites for the critical paths
```

---

## Tests

```bash
npm test            # run all suites
npm run test:watch  # TDD mode
npm run typecheck   # strict TS, no emit
npm run lint        # eslint
```

---

## Roadmap

- [ ] Cross-market arbitrage (structural wiring already in place)
- [ ] Options-style strategies on composite markets
- [ ] Fully algorithmic VWAP / TWAP execution
- [ ] Web dashboard (the terminal one is lovely, but...)
- [ ] Post-hoc calibration re-weighting of ensemble models
- [ ] Public benchmark + anonymized paper-trading leaderboard

PRs welcome.

---

## Contributing

1. Fork it.
2. `npm install && npm test` — make sure the suite is green on your machine.
3. Open an issue first for anything non-trivial so we can align.
4. Write tests for new strategies and agents. The ensemble and portfolio code has real test coverage; let's keep it that way.

---

## FAQ

**Is this guaranteed to make money?**
No. Nothing is. It's a disciplined, multi-model framework that executes a strategy you configure. Markets change. Models drift. Trade small, review logs, start in paper.

**Why OpenRouter instead of direct provider keys?**
One key, five frontier models, built-in failover. The `ModelRouter` tracks per-model health and gracefully demotes flaky models until they recover.

**Can I run just one model?**
Yes. Disable the ensemble in `src/config/settings.ts` (`ensemble.enabled = false`) and the bot falls back to `primaryModel` with automatic fallback to `fallbackModel`.

**How much does it cost to run?**
You control it. The default cap is **$10/day** in LLM spend. At that rate the bot will happily analyze dozens to hundreds of markets per day depending on depth.

**Does it support live trading out of the box?**
Yes — but `LIVE_TRADING_ENABLED=false` by default, and you must explicitly pass `--live` every time. This is intentional.

---

## License

MIT — do what you want, just don't blame us for the drawdowns.

---

<div align="center">

**Built for traders who think like engineers, and engineers who trade like traders.**

*Paper-trade first. Size with Kelly. Listen to the ensemble. Ship.*

</div>
