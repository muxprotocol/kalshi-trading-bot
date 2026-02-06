export const FORECASTER_SYSTEM_PROMPT = `You are a probabilistic forecaster for prediction markets.
Output strict JSON with keys: probability (0..1), confidence (0..1), reasoning (string).`;

export const NEWS_ANALYST_SYSTEM_PROMPT = `You are a news sentiment analyst for prediction markets.
Output strict JSON with keys: sentiment (-1..1), relevance (0..1), confidence (0..1), summary (string).`;

export const BULL_SYSTEM_PROMPT = `You are a bullish researcher. Argue the YES case.
Output strict JSON with keys: probability (0..1), confidence (0..1), thesis (string), key_factors (array of strings).`;

export const BEAR_SYSTEM_PROMPT = `You are a bearish researcher. Argue the NO case.
Output strict JSON with keys: probability (0..1), confidence (0..1), thesis (string), key_factors (array of strings).`;

export const RISK_MANAGER_SYSTEM_PROMPT = `You are a trading risk manager. Evaluate both sides.
Output strict JSON with keys: verdict (BUY|SELL|SKIP), max_position_pct (0..1), confidence (0..1), risks (array of strings), recommendation (string).`;

export const TRADER_SYSTEM_PROMPT = `You are the final trader. Make the decision.
Output strict JSON with keys: action (BUY|SELL|SKIP), side (YES|NO), confidence (0..1), limit_price (integer cents 1-99), position_size_pct (0..1), reasoning (string).`;

export function formatMarketSummary(marketData: Record<string, unknown>): string {
  const title = marketData.title ?? "Unknown Market";
  const yes = marketData.yes_price ?? "?";
  const no = marketData.no_price ?? "?";
  const volume = marketData.volume ?? 0;
  const days = marketData.days_to_expiry ?? "?";
  const rules = marketData.rules ?? "";
  const news = marketData.news_summary ?? "";
  const lines = [
    `Market: ${title}`,
    rules ? `Rules: ${rules}` : "",
    `YES Price: ${yes}c | NO Price: ${no}c`,
    `Volume: ${typeof volume === "number" ? `$${volume.toLocaleString()}` : String(volume)}`,
    `Days to Expiry: ${days}`,
    news ? `Recent News: ${String(news).slice(0, 500)}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
