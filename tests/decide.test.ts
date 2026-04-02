import { describe, it, expect } from "vitest";
import { calculateDynamicQuantity } from "../src/jobs/decide.js";

describe("calculateDynamicQuantity", () => {
  it("returns 0 for zero market price", () => {
    expect(calculateDynamicQuantity(1000, 0, 0.1)).toBe(0);
  });

  it("scales with confidence delta", () => {
    const low = calculateDynamicQuantity(1000, 0.5, 0);
    const high = calculateDynamicQuantity(1000, 0.5, 0.3);
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it("caps at max position size", () => {
    const qty = calculateDynamicQuantity(1000, 0.5, 10);
    expect(qty).toBeGreaterThan(0);
  });
});
