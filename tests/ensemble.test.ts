import { describe, it, expect } from "vitest";
import { EnsembleRunner } from "../src/agents/ensemble.js";
import { ForecasterAgent } from "../src/agents/forecasterAgent.js";
import { BullResearcher } from "../src/agents/bullResearcher.js";
import { BearResearcher } from "../src/agents/bearResearcher.js";

function mockCompletion(json: Record<string, unknown>): () => Promise<string> {
  return async () => JSON.stringify(json);
}

describe("EnsembleRunner", () => {
  it("aggregates multiple agents to a probability", async () => {
    const runner = new EnsembleRunner({
      agents: {
        forecaster: new ForecasterAgent(),
        bull_researcher: new BullResearcher(),
        bear_researcher: new BearResearcher(),
      },
      minModels: 3,
    });
    const market = {
      title: "Will X happen?",
      yes_price: 0.4,
      no_price: 0.6,
      volume: 1000,
      days_to_expiry: 5,
    };
    const completions = {
      forecaster: mockCompletion({ probability: 0.7, confidence: 0.8, reasoning: "bullish" }),
      bull_researcher: mockCompletion({ probability: 0.75, confidence: 0.7, thesis: "x", key_factors: [] }),
      bear_researcher: mockCompletion({ probability: 0.5, confidence: 0.6, thesis: "y", key_factors: [] }),
    };
    const res = await runner.runEnsemble(market, completions);
    expect(res.error).toBeNull();
    expect(res.probability).not.toBeNull();
    if (res.probability !== null) {
      expect(res.probability).toBeGreaterThan(0.5);
      expect(res.probability).toBeLessThan(0.9);
    }
    expect(res.num_models_used).toBe(3);
  });

  it("errors when not enough models succeed", async () => {
    const runner = new EnsembleRunner({
      agents: {
        forecaster: new ForecasterAgent(),
        bull_researcher: new BullResearcher(),
        bear_researcher: new BearResearcher(),
      },
      minModels: 3,
    });
    const market = { title: "foo", yes_price: 0.5, no_price: 0.5, volume: 100 };
    const completions = {
      forecaster: mockCompletion({ probability: 0.6, confidence: 0.6 }),
      bull_researcher: async () => "not json",
      bear_researcher: async () => null,
    };
    const res = await runner.runEnsemble(market, completions);
    expect(res.error).not.toBeNull();
    expect(res.num_models_used).toBeLessThan(3);
  });
});
