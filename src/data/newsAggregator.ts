import Parser from "rss-parser";
import { settings } from "../config/settings.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("newsAggregator");

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt?: string;
  content?: string;
}

export class NewsAggregator {
  private parser: Parser;
  private cache = new Map<string, { items: NewsItem[]; ts: number }>();
  private cacheTtlMs: number;

  constructor() {
    this.parser = new Parser({ timeout: 10_000 });
    this.cacheTtlMs = settings.sentiment.cacheTtlMinutes * 60 * 1000;
  }

  async fetchAll(): Promise<NewsItem[]> {
    const now = Date.now();
    const cached = this.cache.get("all");
    if (cached && now - cached.ts < this.cacheTtlMs) return cached.items;

    const all: NewsItem[] = [];
    for (const url of settings.sentiment.rssFeeds) {
      try {
        const feed = await this.parser.parseURL(url);
        const source = feed.title ?? url;
        const items = (feed.items ?? []).slice(0, settings.sentiment.maxArticlesPerSource).map(
          (it): NewsItem => ({
            title: String(it.title ?? ""),
            link: String(it.link ?? ""),
            source,
            publishedAt: it.isoDate ?? it.pubDate,
            content: String(it.contentSnippet ?? it.content ?? ""),
          })
        );
        all.push(...items);
      } catch (e) {
        logger.warn({ url, err: (e as Error).message }, "RSS fetch failed");
      }
    }
    this.cache.set("all", { items: all, ts: now });
    return all;
  }

  async getMarketRelevantNews(marketTitle: string): Promise<NewsItem[]> {
    const news = await this.fetchAll();
    const keywords = marketTitle
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    if (keywords.length === 0) return news.slice(0, 5);
    const scored = news.map((n) => {
      const text = `${n.title} ${n.content ?? ""}`.toLowerCase();
      const score = keywords.reduce((s, k) => s + (text.includes(k) ? 1 : 0), 0) / keywords.length;
      return { n, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score >= settings.sentiment.relevanceThreshold).map((s) => s.n).slice(0, 10);
  }

  summarize(items: NewsItem[], limit = 5): string {
    return items
      .slice(0, limit)
      .map((n) => `- [${n.source}] ${n.title}`)
      .join("\n");
  }
}
