import { settings } from "../config/settings.js";

export interface StopLossConfig {
  stopLossPrice: number;
  takeProfitPrice: number;
  maxHoldHours: number;
  targetConfidenceChange: number;
}

export function calculateStopLoss(
  entryPrice: number,
  side: "YES" | "NO",
  confidence: number,
  volatility = 0.2
): StopLossConfig {
  const basisLoss = settings.lossThreshold;
  const basisProfit = settings.profitThreshold;
  const volAdjust = settings.volatilityAdjustment ? Math.max(0.5, Math.min(2.0, volatility / 0.2)) : 1.0;
  const loss = entryPrice * (1 - basisLoss * volAdjust);
  const profit = entryPrice * (1 + basisProfit * volAdjust);
  const stopLossPrice = side === "YES" ? loss : Math.min(1, 1 - loss);
  const takeProfitPrice = side === "YES" ? profit : Math.max(0, 1 - profit);
  const maxHoldHours = Math.floor(settings.maxHoldTimeHours * (confidence > 0.7 ? 1.5 : 1.0));
  return {
    stopLossPrice,
    takeProfitPrice,
    maxHoldHours,
    targetConfidenceChange: settings.confidenceDecayThreshold,
  };
}
