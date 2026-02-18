import { BaseAgent, type AgentResult } from "./baseAgent.js";
import { NEWS_ANALYST_SYSTEM_PROMPT } from "../utils/prompts.js";

export class NewsAnalystAgent extends BaseAgent {
  static override AGENT_NAME = "news_analyst";
  static override AGENT_ROLE = "news_analyst";
  static override SYSTEM_PROMPT = NEWS_ANALYST_SYSTEM_PROMPT;
  static override DEFAULT_MODEL = "google/gemini-3.1-flash-lite-preview";

  protected buildPrompt(marketData: Record<string, unknown>): string {
    const news = String(marketData.news_summary ?? "").slice(0, 2000);
    return `Analyze news sentiment and relevance for this market.

${this.formatMarket(marketData)}

News:
${news || "(none)"}

Return JSON:
{"sentiment": <-1..1>, "relevance": <0..1>, "confidence": <0..1>, "summary": "..."}`;
  }

  protected parseResult(raw: Record<string, unknown>): AgentResult {
    return {
      sentiment: this.clamp(raw.sentiment, -1, 1),
      relevance: this.clamp(raw.relevance, 0, 1),
      confidence: this.clamp(raw.confidence, 0, 1),
      summary: String(raw.summary ?? ""),
    };
  }
}
