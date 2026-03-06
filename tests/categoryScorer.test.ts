import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import {
  CategoryScorer,
  computeScore,
  getAllocationPct,
  isBlocked,
  inferCategory,
} from "../src/strategies/categoryScorer.js";

const TEST_DB = ".test_scorer.db";

describe("categoryScorer math", () => {
  it("computes scores in 0-100", () => {
    const s = computeScore(0.75, 0.1, 50, 0.3);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });

  it("returns allocation tiers", () => {
    expect(getAllocationPct(85)).toBe(0.2);
    expect(getAllocationPct(65)).toBe(0.1);
    expect(getAllocationPct(10)).toBe(0);
  });

  it("blocks low scores", () => {
    expect(isBlocked(10)).toBe(true);
    expect(isBlocked(95)).toBe(false);
  });
});

describe("inferCategory", () => {
  it("identifies sports tickers", () => {
    expect(inferCategory("KXNBANYK")).toBe("NBA");
    expect(inferCategory("KXNCAAB-foo")).toBe("NCAAB");
  });
  it("identifies economic tickers", () => {
    expect(inferCategory("KXCPIDEC")).toBe("CPI");
    expect(inferCategory("KXFEDMEET")).toBe("FED");
  });
  it("defaults to OTHER", () => {
    expect(inferCategory("KXRANDOMTHING")).toBe("OTHER");
  });
});

describe("CategoryScorer persistence", () => {
  let scorer: CategoryScorer;
  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    scorer = new CategoryScorer(TEST_DB);
    scorer.initialize();
  });
  afterEach(() => {
    scorer.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("seeds known data", () => {
    const rows = scorer.getAllScores();
    expect(rows.length).toBeGreaterThan(0);
    const ncaab = rows.find((r) => r.category === "NCAAB");
    expect(ncaab).toBeDefined();
  });

  it("updates scores after trades", () => {
    const before = scorer.getScore("TESTCAT");
    expect(before).toBe(0);
    for (let i = 0; i < 6; i++) scorer.updateScore("TESTCAT", true, 0.1);
    const after = scorer.getScore("TESTCAT");
    expect(after).toBeGreaterThan(0);
  });
});
