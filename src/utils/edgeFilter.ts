import { settings } from "../config/settings.js";

export interface EdgeResult {
  hasEdge: boolean;
  edge: number;
  side: "YES" | "NO" | null;
  reason: string;
}

export function computeEdge(marketPrice: number, modelProbability: number): number {
  return modelProbability - marketPrice;
}

export function evaluateEdge(
  yesPrice: number,
  noPrice: number,
  modelYesProb: number,
  minEdge = settings.minTradeEdge
): EdgeResult {
  const yesEdge = modelYesProb - yesPrice;
  const noEdge = 1 - modelYesProb - noPrice;

  if (yesEdge >= minEdge && yesEdge >= noEdge) {
    return { hasEdge: true, edge: yesEdge, side: "YES", reason: `YES edge ${yesEdge.toFixed(3)}` };
  }
  if (noEdge >= minEdge) {
    return { hasEdge: true, edge: noEdge, side: "NO", reason: `NO edge ${noEdge.toFixed(3)}` };
  }
  return { hasEdge: false, edge: Math.max(yesEdge, noEdge), side: null, reason: "edge below threshold" };
}
