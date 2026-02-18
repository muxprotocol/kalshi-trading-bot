import { BaseAgent, type AgentResult } from "./baseAgent.js";
import { TRADER_SYSTEM_PROMPT } from "../utils/prompts.js";

export class TraderAgent extends BaseAgent {
  static override AGENT_NAME = "trader";
  static override AGENT_ROLE = "trader";
  static override SYSTEM_PROMPT = TRADER_SYSTEM_PROMPT;
  static override DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

  protected buildPrompt(marketData: Record<string, unknown>, context: Record<string, unknown>): string {
    const bull = context.bull_researcher as Record<string, unknown> | undefined;
    const bear = context.bear_researcher as Record<string, unknown> | undefined;
    const risk = context.risk_manager as Record<string, unknown> | undefined;
    const forecaster = context.forecaster as Record<string, unknown> | undefined;
    return `Make the final trading decision.

${this.formatMarket(marketData)}

Forecaster YES prob: ${forecaster?.probability ?? "?"}
Bull thesis: ${bull?.thesis ?? ""}
Bear thesis: ${bear?.thesis ?? ""}
Risk verdict: ${risk?.verdict ?? ""} — ${risk?.recommendation ?? ""}

Return JSON:
{"action": "BUY|SELL|SKIP", "side": "YES|NO", "confidence": <0..1>, "limit_price": <1-99 cents>, "position_size_pct": <0..1>, "reasoning": "..."}`;
  }

  protected parseResult(raw: Record<string, unknown>): AgentResult {
    const action = String(raw.action ?? "SKIP").toUpperCase();
    const side = String(raw.side ?? "YES").toUpperCase();
    let limitPrice = Number(raw.limit_price ?? 50);
    if (!Number.isFinite(limitPrice)) limitPrice = 50;
    limitPrice = Math.max(1, Math.min(99, Math.round(limitPrice)));
    return {
      action: ["BUY", "SELL", "SKIP"].includes(action) ? action : "SKIP",
      side: ["YES", "NO"].includes(side) ? side : "YES",
      confidence: this.clamp(raw.confidence, 0, 1),
      limit_price: limitPrice,
      position_size_pct: this.clamp(raw.position_size_pct, 0, 1),
      reasoning: String(raw.reasoning ?? ""),
    };
  }
}
