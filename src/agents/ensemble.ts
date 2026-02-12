import fs from "node:fs";
import path from "node:path";
import { getLogger } from "../utils/logger.js";
import { settings } from "../config/settings.js";
import { BaseAgent, type GetCompletion, type AgentResult } from "./baseAgent.js";
import { ForecasterAgent } from "./forecasterAgent.js";
import { NewsAnalystAgent } from "./newsAnalystAgent.js";
import { BullResearcher } from "./bullResearcher.js";
import { BearResearcher } from "./bearResearcher.js";
import { RiskManagerAgent } from "./riskManagerAgent.js";

const logger = getLogger("ensemble");

export const DEFAULT_WEIGHTS: Record<string, number> = {
  forecaster: 0.3,
  news_analyst: 0.2,
  bull_researcher: 0.2,
  bear_researcher: 0.15,
  risk_manager: 0.15,
};

const CALIBRATION_FILE = "logs/ensemble_calibration.json";

export interface EnsembleResult {
  probability: number | null;
  confidence: number;
  disagreement: number | null;
  model_results: AgentResult[];
  num_models_used: number;
  elapsed_seconds?: number;
  error: string | null;
}

export class EnsembleRunner {
  agents: Record<string, BaseAgent>;
  weights: Record<string, number>;
  minModels: number;
  disagreementThreshold: number;

  constructor(opts: {
    agents?: Record<string, BaseAgent>;
    weights?: Record<string, number>;
    minModels?: number;
    disagreementThreshold?: number;
  } = {}) {
    this.agents = opts.agents ?? EnsembleRunner.defaultAgents();
    this.weights = opts.weights ?? { ...DEFAULT_WEIGHTS };
    this.minModels = opts.minModels ?? settings.ensemble.minModelsForConsensus;
    this.disagreementThreshold = opts.disagreementThreshold ?? settings.ensemble.disagreementThreshold;
  }

  static defaultAgents(): Record<string, BaseAgent> {
    return {
      forecaster: new ForecasterAgent(),
      news_analyst: new NewsAnalystAgent(),
      bull_researcher: new BullResearcher(),
      bear_researcher: new BearResearcher(),
      risk_manager: new RiskManagerAgent(),
    };
  }

  async runEnsemble(
    marketData: Record<string, unknown>,
    getCompletions: Record<string, GetCompletion>,
    context: Record<string, unknown> = {}
  ): Promise<EnsembleResult> {
    const start = Date.now();
    const roles = Object.keys(this.agents).filter((r) => r in getCompletions);
    if (roles.length === 0) return this.errorResult("No matching agents for provided completions");

    logger.info({ roles, market: String(marketData.title ?? "").slice(0, 60) }, "Ensemble starting");

    let resultsMap: Record<string, AgentResult> = {};
    if (settings.ensemble.parallelRequests) {
      const tasks = roles.map(async (role) => {
        try {
          const r = await this.runAgentSafe(role, marketData, context, getCompletions[role]!);
          return [role, r] as const;
        } catch (e) {
          return [role, { error: (e as Error).message, _agent: role } as AgentResult] as const;
        }
      });
      const results = await Promise.all(tasks);
      for (const [role, r] of results) resultsMap[role] = r;
    } else {
      for (const role of roles) {
        resultsMap[role] = await this.runAgentSafe(role, marketData, context, getCompletions[role]!);
      }
    }

    const probs: Array<[string, number, number]> = [];
    const modelResults: AgentResult[] = [];
    for (const [role, r] of Object.entries(resultsMap)) {
      modelResults.push(r);
      if (r.error) continue;
      const prob = this.extractProbability(role, r);
      const conf = Number(r.confidence ?? 0.5);
      if (prob !== null) probs.push([role, prob, conf]);
    }

    if (probs.length < this.minModels) {
      const elapsed = (Date.now() - start) / 1000;
      logger.warn({ successful: probs.length, required: this.minModels }, "Not enough models for consensus");
      return {
        probability: null,
        confidence: 0,
        disagreement: null,
        model_results: modelResults,
        num_models_used: probs.length,
        elapsed_seconds: +elapsed.toFixed(2),
        error: `Only ${probs.length} models succeeded; need ${this.minModels}`,
      };
    }

    const [avg, rawConf, disagreement] = this.aggregate(probs);
    let confidence = rawConf;
    if (disagreement > this.disagreementThreshold) {
      const penalty = Math.min(1, disagreement / this.disagreementThreshold) * 0.3;
      confidence = Math.max(0, rawConf - penalty);
      logger.info({ disagreement: +disagreement.toFixed(4), penalty }, "Disagreement penalty applied");
    }

    const elapsed = (Date.now() - start) / 1000;
    logger.info(
      {
        probability: +avg.toFixed(4),
        confidence: +confidence.toFixed(4),
        disagreement: +disagreement.toFixed(4),
        modelsUsed: probs.length,
      },
      "Ensemble complete"
    );

    if (settings.ensemble.calibrationTracking) {
      this.recordCalibration(marketData, avg, confidence, disagreement, modelResults);
    }

    return {
      probability: +avg.toFixed(4),
      confidence: +confidence.toFixed(4),
      disagreement: +disagreement.toFixed(4),
      model_results: modelResults,
      num_models_used: probs.length,
      elapsed_seconds: +elapsed.toFixed(2),
      error: null,
    };
  }

  private async runAgentSafe(
    role: string,
    marketData: Record<string, unknown>,
    context: Record<string, unknown>,
    getCompletion: GetCompletion
  ): Promise<AgentResult> {
    const agent = this.agents[role];
    if (!agent) return { error: `No agent for role '${role}'`, _agent: role };
    return agent.analyze(marketData, context, getCompletion);
  }

  private extractProbability(role: string, result: AgentResult): number | null {
    if (["forecaster", "bull_researcher", "bear_researcher"].includes(role)) {
      const v = result.probability;
      if (v !== undefined && v !== null) return Number(v);
    }
    if (role === "news_analyst") {
      const sentiment = Number(result.sentiment ?? 0);
      const relevance = Number(result.relevance ?? 0.5);
      const p = 0.5 + sentiment * relevance * 0.5;
      return Math.max(0, Math.min(1, p));
    }
    if (role === "risk_manager") {
      const v = result.probability;
      if (v !== undefined && v !== null) return Number(v);
      return null;
    }
    const v = result.probability;
    return v !== undefined && v !== null ? Number(v) : null;
  }

  private aggregate(probs: Array<[string, number, number]>): [number, number, number] {
    let totalWeight = 0;
    let weightedSum = 0;
    let confidenceSum = 0;
    for (const [role, prob, conf] of probs) {
      const baseW = this.weights[role] ?? 0.1;
      const adjustedW = baseW * Math.max(conf, 0.1);
      weightedSum += prob * adjustedW;
      confidenceSum += conf * baseW;
      totalWeight += adjustedW;
    }
    if (totalWeight === 0) return [0.5, 0, 1];
    const avgProb = weightedSum / totalWeight;
    const totalBase = probs.reduce((s, [r]) => s + (this.weights[r] ?? 0.1), 0);
    const avgConf = totalBase > 0 ? confidenceSum / totalBase : 0.5;
    const values = probs.map(([, p]) => p);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return [avgProb, avgConf, Math.sqrt(variance)];
  }

  private recordCalibration(
    marketData: Record<string, unknown>,
    probability: number,
    confidence: number,
    disagreement: number,
    modelResults: AgentResult[]
  ): void {
    const record = {
      timestamp: new Date().toISOString(),
      market_title: String(marketData.title ?? "").slice(0, 200),
      market_ticker: String(marketData.ticker ?? ""),
      yes_price: marketData.yes_price,
      ensemble_probability: probability,
      ensemble_confidence: confidence,
      disagreement,
      num_models: modelResults.filter((r) => !r.error).length,
      model_probabilities: Object.fromEntries(
        modelResults
          .filter((r) => !r.error && r.probability !== undefined)
          .map((r) => [r._agent ?? "?", r.probability])
      ),
      resolved_yes: null,
    };
    try {
      const dir = path.dirname(CALIBRATION_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let existing: unknown[] = [];
      if (fs.existsSync(CALIBRATION_FILE)) {
        try {
          existing = JSON.parse(fs.readFileSync(CALIBRATION_FILE, "utf8"));
          if (!Array.isArray(existing)) existing = [];
        } catch {
          existing = [];
        }
      }
      existing.push(record);
      if (existing.length > 5000) existing = existing.slice(-5000);
      fs.writeFileSync(CALIBRATION_FILE, JSON.stringify(existing, null, 2));
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "Failed to write calibration record");
    }
  }

  private errorResult(msg: string): EnsembleResult {
    return {
      probability: null,
      confidence: 0,
      disagreement: null,
      model_results: [],
      num_models_used: 0,
      error: msg,
    };
  }
}
