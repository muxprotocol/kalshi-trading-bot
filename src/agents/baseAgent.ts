import { getLogger } from "../utils/logger.js";
import { extractJson, clamp } from "../utils/jsonRepair.js";
import { formatMarketSummary } from "../utils/prompts.js";

export type GetCompletion = (prompt: string) => Promise<string | null>;

export interface AgentResult {
  error?: string;
  _agent?: string;
  _model?: string;
  _elapsed_seconds?: number;
  [key: string]: unknown;
}

export abstract class BaseAgent {
  static AGENT_NAME = "base_agent";
  static AGENT_ROLE = "base";
  static SYSTEM_PROMPT = "";
  static DEFAULT_MODEL = "";

  protected logger = getLogger(`agent.${(this.constructor as typeof BaseAgent).AGENT_NAME}`);
  modelName: string;

  constructor(modelName?: string) {
    this.modelName = modelName ?? (this.constructor as typeof BaseAgent).DEFAULT_MODEL;
  }

  get name(): string {
    return (this.constructor as typeof BaseAgent).AGENT_NAME;
  }
  get role(): string {
    return (this.constructor as typeof BaseAgent).AGENT_ROLE;
  }

  async analyze(
    marketData: Record<string, unknown>,
    context: Record<string, unknown>,
    getCompletion: GetCompletion
  ): Promise<AgentResult> {
    const start = Date.now();
    try {
      const prompt = this.buildUserPrompt(marketData, context);
      const raw = await getCompletion(prompt);
      if (raw === null || raw === undefined) {
        return this.errorResult("Model returned null");
      }
      const parsed = extractJson<Record<string, unknown>>(raw);
      if (!parsed) {
        return this.errorResult(`Failed to parse JSON: ${raw.slice(0, 300)}`);
      }
      const result = this.parseResult(parsed);
      result._agent = this.name;
      result._model = this.modelName;
      result._elapsed_seconds = (Date.now() - start) / 1000;
      return result;
    } catch (e) {
      return this.errorResult((e as Error).message);
    }
  }

  protected buildUserPrompt(marketData: Record<string, unknown>, context: Record<string, unknown>): string {
    const systemPrompt = (this.constructor as typeof BaseAgent).SYSTEM_PROMPT;
    const user = this.buildPrompt(marketData, context);
    return systemPrompt ? `${systemPrompt}\n\n${user}` : user;
  }

  protected abstract buildPrompt(
    marketData: Record<string, unknown>,
    context: Record<string, unknown>
  ): string;

  protected abstract parseResult(raw: Record<string, unknown>): AgentResult;

  protected formatMarket(marketData: Record<string, unknown>): string {
    return formatMarketSummary(marketData);
  }

  protected clamp(value: unknown, lo = 0, hi = 1): number {
    return clamp(value, lo, hi);
  }

  protected errorResult(msg: string): AgentResult {
    this.logger.warn({ agent: this.name, error: msg }, "Agent error result");
    return { error: msg, _agent: this.name, _model: this.modelName };
  }
}
