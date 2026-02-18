import { BaseAgent, type AgentResult } from "./baseAgent.js";
import { FORECASTER_SYSTEM_PROMPT } from "../utils/prompts.js";

export class ForecasterAgent extends BaseAgent {
  static override AGENT_NAME = "forecaster";
  static override AGENT_ROLE = "forecaster";
  static override SYSTEM_PROMPT = FORECASTER_SYSTEM_PROMPT;
  static override DEFAULT_MODEL = "google/gemini-3.1-pro";

  protected buildPrompt(marketData: Record<string, unknown>): string {
    return `Forecast the YES probability for this market.

${this.formatMarket(marketData)}

Return JSON:
{"probability": <0..1>, "confidence": <0..1>, "reasoning": "..."}`;
  }

  protected parseResult(raw: Record<string, unknown>): AgentResult {
    return {
      probability: this.clamp(raw.probability, 0, 1),
      confidence: this.clamp(raw.confidence, 0, 1),
      reasoning: String(raw.reasoning ?? ""),
    };
  }
}
