import { BaseAgent, type AgentResult } from "./baseAgent.js";
import { BULL_SYSTEM_PROMPT } from "../utils/prompts.js";

export class BullResearcher extends BaseAgent {
  static override AGENT_NAME = "bull_researcher";
  static override AGENT_ROLE = "bull_researcher";
  static override SYSTEM_PROMPT = BULL_SYSTEM_PROMPT;
  static override DEFAULT_MODEL = "deepseek/deepseek-v3.2";

  protected buildPrompt(marketData: Record<string, unknown>, context: Record<string, unknown>): string {
    const forecaster = context.forecaster as Record<string, unknown> | undefined;
    const news = context.news_analyst as Record<string, unknown> | undefined;
    return `Build the strongest bullish case (YES) for this market.

${this.formatMarket(marketData)}

Forecaster's probability: ${forecaster?.probability ?? "?"}
News sentiment: ${news?.sentiment ?? "?"} (relevance ${news?.relevance ?? "?"})

Return JSON:
{"probability": <0..1>, "confidence": <0..1>, "thesis": "...", "key_factors": ["..."]}`;
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
