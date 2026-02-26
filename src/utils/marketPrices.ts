export interface MarketPrices {
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
  yesMid: number;
  noMid: number;
  spread: number;
}

export function getMarketPrices(market: Record<string, unknown>): MarketPrices {
  const hasDollars = "yes_bid_dollars" in market;
  let yesBid: number;
  let yesAsk: number;
  let noBid: number;
  let noAsk: number;
  if (hasDollars) {
    yesBid = Number(market.yes_bid_dollars ?? 0) || 0;
    yesAsk = Number(market.yes_ask_dollars ?? 0) || 0;
    noBid = Number(market.no_bid_dollars ?? 0) || 0;
    noAsk = Number(market.no_ask_dollars ?? 0) || 0;
  } else {
    yesBid = Number(market.yes_bid ?? 0) / 100;
    yesAsk = Number(market.yes_ask ?? 0) / 100;
    noBid = Number(market.no_bid ?? 0) / 100;
    noAsk = Number(market.no_ask ?? 0) / 100;
  }
  const yesMid = (yesBid + yesAsk) / 2;
  const noMid = (noBid + noAsk) / 2;
  const spread = Math.abs(yesAsk - yesBid);
  return { yesBid, yesAsk, noBid, noAsk, yesMid, noMid, spread };
}

export function isTradeableMarket(market: Record<string, unknown>): boolean {
  const p = getMarketPrices(market);
  const COLLECTION_THRESHOLD = 0.98;
  if (p.yesAsk >= COLLECTION_THRESHOLD && p.noAsk >= COLLECTION_THRESHOLD) return false;
  if (p.yesAsk <= 0 || p.noAsk <= 0) return false;
  if (String(market.status ?? "").toLowerCase() !== "active" && market.status !== undefined && market.status !== "open") {
    return Boolean(market.status ?? true);
  }
  return true;
}
