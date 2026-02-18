import { BaseAgent, type AgentResult } from "./baseAgent.js";
import { BEAR_SYSTEM_PROMPT } from "../utils/prompts.js";

export class BearResearcher extends BaseAgent {
  static override AGENT_NAME = "bear_researcher";
  static override AGENT_ROLE = "bear_researcher";
  static override SYSTEM_PROMPT = BEAR_SYSTEM_PROMPT;
  static override DEFAULT_MODEL = "x-ai/grok-4.1-fast";

  protected buildPrompt(marketData: Record<string, unknown>, context: Record<string, unknown>): string {
    const bull = context.bull_researcher as Record<string, unknown> | undefined;
    return `Build the strongest bearish case (NO) for this market. Rebut the bull's claims.

${this.formatMarket(marketData)}

Bull's thesis: ${bull?.thesis ?? "(none)"}

Return JSON:
{"probability": <0..1 YES prob — lower is more bearish>, "confidence": <0..1>, "thesis": "...", "key_factors": ["..."]}`;
  }

  protected parseResult(raw: Record<string, unknown>): AgentResult {
    return {
      probability: this.clamp(raw.probability, 0, 1),
      confidence: this.clamp(raw.confidence, 0, 1),
      thesis: String(raw.thesis ?? ""),
      key_factors: Array.isArray(raw.key_factors) ? (raw.key_factors as string[]) : [],
    };
  }
}
