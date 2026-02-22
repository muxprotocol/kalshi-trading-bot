import type { ModelRouter } from "../clients/modelRouter.js";
import { NewsAggregator, type NewsItem } from "./newsAggregator.js";
import { settings } from "../config/settings.js";
import { extractJson, clamp } from "../utils/jsonRepair.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("sentiment");

export interface SentimentResult {
  sentiment: number;
  relevance: number;
  confidence: number;
  summary: string;
  newsItems: NewsItem[];
}

export class SentimentAnalyzer {
  private cache = new Map<string, { result: SentimentResult; ts: number }>();
  private cacheTtlMs: number;
  private aggregator: NewsAggregator;

  constructor(private modelRouter: ModelRouter) {
    this.cacheTtlMs = settings.sentiment.cacheTtlMinutes * 60 * 1000;
    this.aggregator = new NewsAggregator();
  }

  async analyze(marketTitle: string): Promise<SentimentResult> {
    const cached = this.cache.get(marketTitle);
    if (cached && Date.now() - cached.ts < this.cacheTtlMs) return cached.result;

    const items = await this.aggregator.getMarketRelevantNews(marketTitle);
    if (items.length === 0) {
      const empty: SentimentResult = {
        sentiment: 0,
        relevance: 0,
        confidence: 0,
        summary: "No news found",
        newsItems: [],
      };
      return empty;
    }
    const newsText = items.map((n) => `- ${n.title}\n  ${n.content ?? ""}`.slice(0, 400)).join("\n");
    const prompt = `Analyze news sentiment for this prediction market.

MARKET: ${marketTitle}

NEWS:
${newsText}

Return strict JSON:
{"sentiment": <-1..1>, "relevance": <0..1>, "confidence": <0..1>, "summary": "..."}`;

    const raw = await this.modelRouter.getCompletion({
      prompt,
      model: settings.sentiment.sentimentModel,
      strategy: "sentiment",
      queryType: "news_sentiment",
    });
    let result: SentimentResult = {
      sentiment: 0,
      relevance: 0,
      confidence: 0,
      summary: "parse failed",
      newsItems: items,
    };
    if (raw) {
      const parsed = extractJson<Record<string, unknown>>(raw);
      if (parsed) {
        result = {
          sentiment: clamp(parsed.sentiment, -1, 1),
          relevance: clamp(parsed.relevance, 0, 1),
          confidence: clamp(parsed.confidence, 0, 1),
          summary: String(parsed.summary ?? ""),
          newsItems: items,
        };
      }
    }
    this.cache.set(marketTitle, { result, ts: Date.now() });
    logger.info({ marketTitle, sentiment: result.sentiment, relevance: result.relevance }, "Sentiment computed");
    return result;
  }
}
