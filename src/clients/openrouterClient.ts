import OpenAI from "openai";
import { settings } from "../config/settings.js";
import { getLogger } from "../utils/logger.js";
import { DailyUsageTracker } from "../utils/dailyUsageTracker.js";
import type { DatabaseManager } from "../utils/database.js";
import { extractJson } from "../utils/jsonRepair.js";

const logger = getLogger("openrouterClient");

export interface ModelPricing {
  input_per_1k: number;
  output_per_1k: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "anthropic/claude-sonnet-4.5": { input_per_1k: 0.003, output_per_1k: 0.015 },
  "anthropic/claude-sonnet-4": { input_per_1k: 0.003, output_per_1k: 0.015 },
  "openai/gpt-5.4": { input_per_1k: 0.002, output_per_1k: 0.008 },
  "openai/gpt-4.1": { input_per_1k: 0.002, output_per_1k: 0.008 },
  "openai/o3": { input_per_1k: 0.002, output_per_1k: 0.008 },
  "google/gemini-3.1-pro": { input_per_1k: 0.00125, output_per_1k: 0.01 },
  "google/gemini-3.1-flash-lite-preview": { input_per_1k: 0.00015, output_per_1k: 0.0006 },
  "google/gemini-2.5-pro-preview": { input_per_1k: 0.00125, output_per_1k: 0.01 },
  "deepseek/deepseek-v3.2": { input_per_1k: 0.0008, output_per_1k: 0.002 },
  "deepseek/deepseek-r1": { input_per_1k: 0.0008, output_per_1k: 0.002 },
  "x-ai/grok-4.1-fast": { input_per_1k: 0.0008, output_per_1k: 0.004 },
};

export const DEFAULT_FALLBACK_ORDER = [
  "anthropic/claude-sonnet-4.5",
  "openai/gpt-5.4",
  "google/gemini-3.1-pro",
  "deepseek/deepseek-v3.2",
];

export interface ModelCostTracker {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  requestCount: number;
  errorCount: number;
  lastUsed: Date | null;
}

export interface TradingDecision {
  action: "BUY" | "SELL" | "SKIP";
  side?: "YES" | "NO";
  limit_price?: number;
  confidence: number;
  position_size_pct?: number;
  reasoning?: string;
  model?: string;
}

export class OpenRouterClient {
  private client: OpenAI;
  private defaultModel: string;
  private temperature: number;
  private maxTokens: number;
  private dbManager: DatabaseManager | null;
  modelCosts: Record<string, ModelCostTracker> = {};
  totalCost = 0;
  requestCount = 0;
  private usageFile = "logs/daily_openrouter_usage.json";
  dailyTracker: DailyUsageTracker;
  _lastRequestCost = 0;

  static MAX_RETRIES_PER_MODEL = 3;
  static BASE_BACKOFF = 1.0;
  static MAX_BACKOFF = 30.0;

  constructor(opts: { apiKey?: string; defaultModel?: string; dbManager?: DatabaseManager } = {}) {
    const apiKey = opts.apiKey ?? settings.api.openrouterApiKey;
    this.defaultModel = opts.defaultModel ?? "anthropic/claude-sonnet-4.5";
    this.dbManager = opts.dbManager ?? null;
    this.client = new OpenAI({
      apiKey,
      baseURL: settings.api.openrouterBaseUrl,
      timeout: 120_000,
      maxRetries: 0,
    });
    this.temperature = settings.trading.aiTemperature;
    this.maxTokens = settings.trading.aiMaxTokens;

    for (const m of Object.keys(MODEL_PRICING)) {
      this.modelCosts[m] = {
        model: m,
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
        requestCount: 0,
        errorCount: 0,
        lastUsed: null,
      };
    }
    this.dailyTracker = DailyUsageTracker.load(this.usageFile, settings.trading.dailyAiCostLimit);

    logger.info(
      {
        defaultModel: this.defaultModel,
        dailyLimit: this.dailyTracker.dailyLimit,
        todayCost: this.dailyTracker.totalCost,
      },
      "OpenRouter client initialized"
    );
  }

  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const p = MODEL_PRICING[model];
    if (!p) return 0;
    return (inputTokens / 1000) * p.input_per_1k + (outputTokens / 1000) * p.output_per_1k;
  }

  private recordUsage(model: string, inputTokens: number, outputTokens: number): number {
    const cost = this.calculateCost(model, inputTokens, outputTokens);
    const t = this.modelCosts[model];
    if (t) {
      t.inputTokens += inputTokens;
      t.outputTokens += outputTokens;
      t.totalCost += cost;
      t.requestCount += 1;
      t.lastUsed = new Date();
    }
    this.totalCost += cost;
    this.requestCount += 1;
    this.dailyTracker.recordCost(cost);
    this.dailyTracker.save(this.usageFile);
    this._lastRequestCost = cost;
    return cost;
  }

  async getCompletion(opts: {
    prompt: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    strategy?: string;
    queryType?: string;
    marketId?: string;
  }): Promise<string | null> {
    const model = opts.model ?? this.defaultModel;
    const maxTokens = opts.maxTokens ?? this.maxTokens;
    const temperature = opts.temperature ?? this.temperature;

    const models = [model, ...DEFAULT_FALLBACK_ORDER.filter((m) => m !== model)];

    for (const m of models) {
      for (let attempt = 0; attempt < OpenRouterClient.MAX_RETRIES_PER_MODEL; attempt++) {
        try {
          const resp = await this.client.chat.completions.create({
            model: m,
            messages: [{ role: "user", content: opts.prompt }],
            temperature,
            max_tokens: maxTokens,
          });
          const text = resp.choices[0]?.message?.content ?? null;
          const usage = resp.usage;
          const cost = this.recordUsage(
            m,
            usage?.prompt_tokens ?? 0,
            usage?.completion_tokens ?? 0
          );
          if (this.dbManager && text) {
            try {
              this.dbManager.insertLLMQuery({
                timestamp: new Date().toISOString(),
                strategy: opts.strategy ?? "unknown",
                query_type: opts.queryType ?? "completion",
                market_id: opts.marketId ?? null,
                prompt: opts.prompt,
                response: text,
                tokens_used: (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
                cost_usd: cost,
              });
            } catch (e) {
              logger.warn({ err: (e as Error).message }, "Failed to log LLM query");
            }
          }
          return text;
        } catch (err) {
          const tracker = this.modelCosts[m];
          if (tracker) tracker.errorCount += 1;
          const e = err as Error;
          const delay = Math.min(
            OpenRouterClient.MAX_BACKOFF,
            OpenRouterClient.BASE_BACKOFF * 2 ** attempt
          ) * 1000;
          logger.warn({ model: m, attempt, err: e.message }, "OpenRouter request failed, retrying");
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    logger.error("All OpenRouter models failed");
    return null;
  }

  async getTradingDecision(opts: {
    marketData: Record<string, unknown>;
    portfolioData?: Record<string, unknown>;
    newsSummary?: string;
    model?: string;
  }): Promise<TradingDecision | null> {
    const prompt = this.buildDecisionPrompt(
      opts.marketData,
      opts.portfolioData ?? {},
      opts.newsSummary ?? ""
    );
    const text = await this.getCompletion({
      prompt,
      model: opts.model,
      strategy: "single_model",
      queryType: "trading_decision",
      marketId: String(opts.marketData.ticker ?? opts.marketData.market_id ?? ""),
    });
    if (!text) return null;
    const parsed = extractJson<Record<string, unknown>>(text);
    if (!parsed) return null;
    const action = String(parsed.action ?? "SKIP").toUpperCase();
    if (!["BUY", "SELL", "SKIP"].includes(action)) return null;
    return {
      action: action as TradingDecision["action"],
      side: parsed.side ? (String(parsed.side).toUpperCase() as "YES" | "NO") : undefined,
      limit_price: typeof parsed.limit_price === "number" ? parsed.limit_price : undefined,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
      position_size_pct:
        typeof parsed.position_size_pct === "number" ? parsed.position_size_pct : undefined,
      reasoning: String(parsed.reasoning ?? ""),
      model: opts.model ?? this.defaultModel,
    };
  }

  private buildDecisionPrompt(
    market: Record<string, unknown>,
    portfolio: Record<string, unknown>,
    news: string
  ): string {
    return `You are a trading system for Kalshi prediction markets.
Analyze the market and output a strict JSON decision.

MARKET:
title: ${market.title}
ticker: ${market.ticker ?? market.market_id}
yes_price: ${market.yes_price}
no_price: ${market.no_price}
volume: ${market.volume}
rules: ${market.rules ?? ""}

PORTFOLIO: ${JSON.stringify(portfolio).slice(0, 1000)}

NEWS: ${news.slice(0, 1500)}

Return ONLY JSON with keys:
action: "BUY" | "SELL" | "SKIP"
side: "YES" | "NO"
limit_price: integer in cents (1-99)
confidence: 0..1
position_size_pct: 0..1
reasoning: string`;
  }

  async close(): Promise<void> {
    this.dailyTracker.save(this.usageFile);
  }
}
