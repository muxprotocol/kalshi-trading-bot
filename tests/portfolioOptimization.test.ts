import { describe, it, expect } from "vitest";
import {
  AdvancedPortfolioOptimizer,
  kellyFraction,
  type MarketOpportunity,
} from "../src/strategies/portfolioOptimization.js";

describe("kellyFraction", () => {
  it("returns 0 for no edge", () => {
    expect(kellyFraction(0.5, 0.5)).toBe(0);
    expect(kellyFraction(0.4, 0.5)).toBe(0);
  });

  it("returns positive fraction with edge", () => {
    expect(kellyFraction(0.7, 0.5)).toBeGreaterThan(0);
  });

  it("caps at 0.25", () => {
    expect(kellyFraction(0.99, 0.5)).toBeLessThanOrEqual(0.25);
  });
});

describe("AdvancedPortfolioOptimizer", () => {
  it("allocates to high-edge opportunities only", () => {
    const opps: MarketOpportunity[] = [
      {
        ticker: "A",
        title: "a",
        modelProbability: 0.7,
        marketPrice: 0.5,
        side: "YES",
        confidence: 0.8,
        edge: 0.2,
        volume: 10000,
        expectedReturn: 0.2,
        volatility: 0.2,
      },
      {
        ticker: "B",
        title: "b",
        modelProbability: 0.51,
        marketPrice: 0.5,
        side: "YES",
        confidence: 0.5,
        edge: 0.01,
        volume: 10000,
        expectedReturn: 0.01,
        volatility: 0.2,
      },
    ];
    const optimizer = new AdvancedPortfolioOptimizer(1000);
    const result = optimizer.optimize(opps);
    expect(result.allocations.length).toBeGreaterThan(0);
    expect(result.allocations[0].ticker).toBe("A");
  });
});
