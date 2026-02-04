import { OpenRouterClient, type TradingDecision } from "./openrouterClient.js";
import { DailyUsageTracker } from "../utils/dailyUsageTracker.js";
import { settings } from "../config/settings.js";
import type { DatabaseManager } from "../utils/database.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("modelRouter");

export type Capability = "fast" | "cheap" | "reasoning" | "balanced";

export const CAPABILITY_MAP: Record<Capability, Array<[string, string]>> = {
  fast: [
    ["x-ai/grok-4.1-fast", "openrouter"],
    ["google/gemini-3.1-pro", "openrouter"],
  ],
  cheap: [
    ["deepseek/deepseek-v3.2", "openrouter"],
    ["google/gemini-3.1-pro", "openrouter"],
  ],
  reasoning: [
    ["anthropic/claude-sonnet-4.5", "openrouter"],
    ["openai/gpt-5.4", "openrouter"],
    ["google/gemini-3.1-pro", "openrouter"],
  ],
  balanced: [
    ["anthropic/claude-sonnet-4.5", "openrouter"],
    ["openai/gpt-5.4", "openrouter"],
    ["x-ai/grok-4.1-fast", "openrouter"],
  ],
};

export const FULL_FLEET: Array<[string, string]> = [
  ["anthropic/claude-sonnet-4.5", "openrouter"],
  ["google/gemini-3.1-pro", "openrouter"],
  ["openai/gpt-5.4", "openrouter"],
  ["deepseek/deepseek-v3.2", "openrouter"],
  ["x-ai/grok-4.1-fast", "openrouter"],
];

export class ModelHealth {
  totalRequests = 0;
  successfulRequests = 0;
  failedRequests = 0;
  consecutiveFailures = 0;
  lastFailureTime: Date | null = null;
  lastSuccessTime: Date | null = null;
  totalLatency = 0;

  constructor(public model: string, public provider: string) {}

  get successRate(): number {
    if (this.totalRequests === 0) return 1.0;
    return this.successfulRequests / this.totalRequests;
  }

  get avgLatency(): number {
    return this.successfulRequests === 0 ? 0 : this.totalLatency / this.successfulRequests;
  }

  get isHealthy(): boolean {
    if (this.consecutiveFailures < 5) return true;
    if (!this.lastFailureTime) return true;
    const cooldownMs = 5 * 60 * 1000;
    return Date.now() - this.lastFailureTime.getTime() > cooldownMs;
  }

  recordSuccess(latency: number): void {
    this.totalRequests++;
    this.successfulRequests++;
    this.consecutiveFailures = 0;
    this.lastSuccessTime = new Date();
    this.totalLatency += latency;
  }

  recordFailure(): void {
    this.totalRequests++;
    this.failedRequests++;
    this.consecutiveFailures++;
    this.lastFailureTime = new Date();
  }
}

export class ModelRouter {
  private openrouterClient: OpenRouterClient | null;
  private dbManager: DatabaseManager | null;
  modelHealth: Record<string, ModelHealth> = {};
  private usageFile = "logs/daily_ai_usage.json";
  dailyTracker: DailyUsageTracker;

  constructor(opts: { openrouterClient?: OpenRouterClient; dbManager?: DatabaseManager } = {}) {
    this.openrouterClient = opts.openrouterClient ?? null;
    this.dbManager = opts.dbManager ?? null;
    this.dailyTracker = DailyUsageTracker.load(this.usageFile, settings.trading.dailyAiCostLimit);
    for (const [model, provider] of FULL_FLEET) {
      this.modelHealth[this.key(model, provider)] = new ModelHealth(model, provider);
    }
    logger.info({ fleetSize: FULL_FLEET.length }, "ModelRouter initialized (OpenRouter only)");
  }

  private key(model: string, provider: string): string {
    return `${provider}::${model}`;
  }

  private ensureClient(): OpenRouterClient {
    if (!this.openrouterClient) {
      this.openrouterClient = new OpenRouterClient({ dbManager: this.dbManager ?? undefined });
    }
    return this.openrouterClient;
  }

  private isHealthy(model: string, provider: string): boolean {
    return this.modelHealth[this.key(model, provider)]?.isHealthy ?? true;
  }

  private recordSuccess(model: string, provider: string, latency: number): void {
    this.modelHealth[this.key(model, provider)]?.recordSuccess(latency);
  }

  private recordFailure(model: string, provider: string): void {
    this.modelHealth[this.key(model, provider)]?.recordFailure();
  }

  private resolveTargets(model?: string, capability?: Capability): Array<[string, string]> {
    let targets: Array<[string, string]>;
    if (model) targets = [[model, "openrouter"]];
    else if (capability) targets = [...CAPABILITY_MAP[capability]];
    else targets = [...FULL_FLEET];
    const seen = new Set(targets.map(([m, p]) => `${p}::${m}`));
    for (const entry of FULL_FLEET) {
      const k = `${entry[1]}::${entry[0]}`;
      if (!seen.has(k)) {
        targets.push(entry);
        seen.add(k);
      }
    }
    const healthy = targets.filter(([m, p]) => this.isHealthy(m, p));
    return healthy.length >= 2 ? healthy : targets;
  }

  async checkDailyLimits(): Promise<boolean> {
    this.dailyTracker = DailyUsageTracker.load(this.usageFile, settings.trading.dailyAiCostLimit);
    if (this.dailyTracker.isExhausted) {
      const today = new Date().toISOString().slice(0, 10);
      if (this.dailyTracker.date !== today) {
        this.dailyTracker = new DailyUsageTracker({ date: today, dailyLimit: this.dailyTracker.dailyLimit });
        this.dailyTracker.save(this.usageFile);
        return true;
      }
      return false;
    }
    return true;
  }

  private updateDailyCost(cost: number): void {
    this.dailyTracker.recordCost(cost);
    this.dailyTracker.save(this.usageFile);
  }

  async getCompletion(opts: {
    prompt: string;
    model?: string;
    capability?: Capability;
    maxTokens?: number;
    temperature?: number;
    strategy?: string;
    queryType?: string;
    marketId?: string;
  }): Promise<string | null> {
    const canProceed = await this.checkDailyLimits();
    if (!canProceed) return null;
    const targets = this.resolveTargets(opts.model, opts.capability);
    for (const [m, p] of targets) {
      const start = Date.now();
      const client = this.ensureClient();
      try {
        const text = await client.getCompletion({
          prompt: opts.prompt,
          model: m,
          maxTokens: opts.maxTokens,
          temperature: opts.temperature,
          strategy: opts.strategy,
          queryType: opts.queryType,
          marketId: opts.marketId,
        });
        if (text !== null) {
          this.recordSuccess(m, p, (Date.now() - start) / 1000);
          this.updateDailyCost(client._lastRequestCost);
          return text;
        }
        this.recordFailure(m, p);
      } catch (e) {
        this.recordFailure(m, p);
        logger.warn({ model: m, err: (e as Error).message }, "Model failed, trying next");
      }
    }
    return null;
  }

  async getTradingDecision(opts: {
    marketData: Record<string, unknown>;
    portfolioData?: Record<string, unknown>;
    newsSummary?: string;
    model?: string;
  }): Promise<TradingDecision | null> {
    const canProceed = await this.checkDailyLimits();
    if (!canProceed) return null;
    const client = this.ensureClient();
    const decision = await client.getTradingDecision(opts);
    if (decision) this.updateDailyCost(client._lastRequestCost);
    return decision;
  }

  async close(): Promise<void> {
    if (this.openrouterClient) await this.openrouterClient.close();
  }
}
