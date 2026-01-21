import { describe, it, expect } from "vitest";
import { extractJson, tryParseJson, repairJson, clamp } from "../src/utils/jsonRepair.js";

describe("jsonRepair", () => {
  it("extracts JSON from code fences", () => {
    const input = "Sure! ```json\n{\"a\": 1}\n```";
    const parsed = extractJson<{ a: number }>(input);
    expect(parsed).toEqual({ a: 1 });
  });

  it("parses raw JSON", () => {
    expect(tryParseJson<{ b: number }>('{"b": 2}')).toEqual({ b: 2 });
  });

  it("repairs trailing commas and single quotes", () => {
    const repaired = repairJson("{ a: 1, b: 'hi', }");
    expect(JSON.parse(repaired)).toEqual({ a: 1, b: "hi" });
  });

  it("extracts JSON from messy LLM output", () => {
    const input = "Here is my answer: {\"probability\": 0.6, \"confidence\": 0.7}. Thanks!";
    const parsed = extractJson<Record<string, number>>(input);
    expect(parsed?.probability).toBe(0.6);
  });

  it("clamps values", () => {
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp("not a number" as unknown, 0, 1)).toBe(0);
  });
});
