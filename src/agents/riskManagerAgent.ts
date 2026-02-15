import { BaseAgent, type AgentResult } from "./baseAgent.js";
import { RISK_MANAGER_SYSTEM_PROMPT } from "../utils/prompts.js";

export class RiskManagerAgent extends BaseAgent {
  static override AGENT_NAME = "risk_manager";
  static override AGENT_ROLE = "risk_manager";
  static override SYSTEM_PROMPT = RISK_MANAGER_SYSTEM_PROMPT;
  static override DEFAULT_MODEL = "openai/gpt-5.4";

  protected buildPrompt(marketData: Record<string, unknown>, context: Record<string, unknown>): string {
    const bull = context.bull_researcher as Record<string, unknown> | undefined;
    const bear = context.bear_researcher as Record<string, unknown> | undefined;
    const portfolio = context.portfolio ?? {};
    return `Evaluate risk for trading this market.

${this.formatMarket(marketData)}

Bull thesis: ${bull?.thesis ?? "(none)"}
Bear thesis: ${bear?.thesis ?? "(none)"}
Portfolio: ${JSON.stringify(portfolio).slice(0, 800)}

Return JSON:
{"verdict": "BUY|SELL|SKIP", "max_position_pct": <0..1>, "confidence": <0..1>, "risks": ["..."], "recommendation": "..."}`;
  }

  protected parseResult(raw: Record<string, unknown>): AgentResult {
    const verdict = String(raw.verdict ?? "SKIP").toUpperCase();
    return {
      verdict: ["BUY", "SELL", "SKIP"].includes(verdict) ? verdict : "SKIP",
      max_position_pct: this.clamp(raw.max_position_pct, 0, 1),
      confidence: this.clamp(raw.confidence, 0, 1),
      probability: typeof raw.probability === "number" ? this.clamp(raw.probability, 0, 1) : undefined,
      risks: Array.isArray(raw.risks) ? (raw.risks as string[]) : [],
      recommendation: String(raw.recommendation ?? ""),
    };
  }
}
