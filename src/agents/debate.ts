import { getLogger } from "../utils/logger.js";
import { BaseAgent, type GetCompletion, type AgentResult } from "./baseAgent.js";
import { ForecasterAgent } from "./forecasterAgent.js";
import { NewsAnalystAgent } from "./newsAnalystAgent.js";
import { BullResearcher } from "./bullResearcher.js";
import { BearResearcher } from "./bearResearcher.js";
import { RiskManagerAgent } from "./riskManagerAgent.js";
import { TraderAgent } from "./traderAgent.js";

const logger = getLogger("debate");

export interface DebateResult {
  action: "BUY" | "SELL" | "SKIP";
  side?: "YES" | "NO";
  limit_price?: number;
  confidence: number;
  position_size_pct?: number;
  reasoning: string;
  debate_transcript: string;
  step_results: Record<string, AgentResult>;
  elapsed_seconds: number;
  error: string | null;
}

export class DebateRunner {
  agents: Record<string, BaseAgent>;

  constructor(agents?: Record<string, BaseAgent>) {
    this.agents = agents ?? {
      forecaster: new ForecasterAgent(),
      news_analyst: new NewsAnalystAgent(),
      bull_researcher: new BullResearcher(),
      bear_researcher: new BearResearcher(),
      risk_manager: new RiskManagerAgent(),
      trader: new TraderAgent(),
    };
  }

  async runDebate(
    marketData: Record<string, unknown>,
    getCompletions: Record<string, GetCompletion>,
    context: Record<string, unknown> = {}
  ): Promise<DebateResult> {
    const start = Date.now();
    const ctx: Record<string, unknown> = { ...context };
    const transcriptParts: string[] = [];
    const stepResults: Record<string, AgentResult> = {};

    const marketTitle = String(marketData.title ?? "Unknown").slice(0, 80);
    logger.info({ market: marketTitle }, "Debate starting");

    const runStep = async (role: string): Promise<AgentResult | null> => {
      const agent = this.agents[role];
      const fn = getCompletions[role];
      if (!agent || !fn) return null;
      const r = await agent.analyze(marketData, ctx, fn);
      stepResults[role] = r;
      ctx[role] = r;
      transcriptParts.push(`### ${role}\n${r.error ? `ERROR: ${r.error}` : JSON.stringify(r)}`);
      return r;
    };

    try {
      const parallelPre = await Promise.all([runStep("forecaster"), runStep("news_analyst")]);
      void parallelPre;
      await runStep("bull_researcher");
      await runStep("bear_researcher");
      await runStep("risk_manager");
      const trader = await runStep("trader");

      const transcript = transcriptParts.join("\n\n");
      const elapsed = (Date.now() - start) / 1000;

      if (!trader || trader.error) {
        return {
          action: "SKIP",
          confidence: 0,
          reasoning: "Trader step failed",
          debate_transcript: transcript,
          step_results: stepResults,
          elapsed_seconds: +elapsed.toFixed(2),
          error: trader?.error ?? "trader missing",
        };
      }

      return {
        action: (trader.action as DebateResult["action"]) ?? "SKIP",
        side: trader.side as "YES" | "NO" | undefined,
        limit_price: typeof trader.limit_price === "number" ? trader.limit_price : undefined,
        confidence: Number(trader.confidence ?? 0),
        position_size_pct:
          typeof trader.position_size_pct === "number" ? trader.position_size_pct : undefined,
        reasoning: String(trader.reasoning ?? ""),
        debate_transcript: transcript,
        step_results: stepResults,
        elapsed_seconds: +elapsed.toFixed(2),
        error: null,
      };
    } catch (e) {
      const elapsed = (Date.now() - start) / 1000;
      return {
        action: "SKIP",
        confidence: 0,
        reasoning: "debate failed",
        debate_transcript: transcriptParts.join("\n\n"),
        step_results: stepResults,
        elapsed_seconds: +elapsed.toFixed(2),
        error: (e as Error).message,
      };
    }
  }
}
