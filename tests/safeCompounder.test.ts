import { describe, it, expect } from "vitest";
import {
  shouldSkip,
  estimateTrueNoProb,
  kellyFraction,
  SKIP_PREFIXES,
} from "../src/strategies/safeCompounder.js";

describe("safeCompounder", () => {
  it("skips sports tickers", () => {
    expect(shouldSkip("KXNBA-LAL")).toBe(true);
    expect(shouldSkip("KXNFL-WAS")).toBe(true);
    expect(shouldSkip("KXECON-CPI")).toBe(false);
  });

  it("has expected skip prefixes", () => {
    expect(SKIP_PREFIXES.length).toBeGreaterThan(10);
  });

  it("estimates true NO prob with time boost", () => {
    const longExpiry = estimateTrueNoProb(0.2, 200);
    const shortExpiry = estimateTrueNoProb(0.2, 5);
    expect(shortExpiry).toBeGreaterThan(longExpiry);
  });

  it("kellyFraction bounded", () => {
    expect(kellyFraction(0.9, 0.8)).toBeGreaterThan(0);
    expect(kellyFraction(0.9, 0.8)).toBeLessThanOrEqual(0.25);
  });
});
