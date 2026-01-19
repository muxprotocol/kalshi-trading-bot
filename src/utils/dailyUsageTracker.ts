import fs from "node:fs";
import path from "node:path";
import { getLogger } from "./logger.js";

const logger = getLogger("dailyUsage");

export interface DailyUsageData {
  date: string;
  totalCost: number;
  requestCount: number;
  dailyLimit: number;
  isExhausted: boolean;
  lastExhaustedTime: string | null;
}

export class DailyUsageTracker {
  date: string;
  totalCost: number;
  requestCount: number;
  dailyLimit: number;
  isExhausted: boolean;
  lastExhaustedTime: string | null;

  constructor(data: Partial<DailyUsageData> = {}) {
    const today = new Date().toISOString().slice(0, 10);
    this.date = data.date ?? today;
    this.totalCost = data.totalCost ?? 0;
    this.requestCount = data.requestCount ?? 0;
    this.dailyLimit = data.dailyLimit ?? 10.0;
    this.isExhausted = data.isExhausted ?? false;
    this.lastExhaustedTime = data.lastExhaustedTime ?? null;
  }

  toJSON(): DailyUsageData {
    return {
      date: this.date,
      totalCost: this.totalCost,
      requestCount: this.requestCount,
      dailyLimit: this.dailyLimit,
      isExhausted: this.isExhausted,
      lastExhaustedTime: this.lastExhaustedTime,
    };
  }

  static load(file: string, dailyLimit: number): DailyUsageTracker {
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, "utf8")) as DailyUsageData;
        const today = new Date().toISOString().slice(0, 10);
        if (raw.date !== today) {
          return new DailyUsageTracker({ date: today, dailyLimit });
        }
        const t = new DailyUsageTracker(raw);
        t.dailyLimit = dailyLimit;
        if (t.isExhausted && t.totalCost < dailyLimit) t.isExhausted = false;
        return t;
      }
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "Failed to load daily tracker");
    }
    return new DailyUsageTracker({ dailyLimit });
  }

  save(file: string): void {
    try {
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(this.toJSON(), null, 2));
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "Failed to save daily tracker");
    }
  }

  recordCost(cost: number): void {
    this.totalCost += cost;
    this.requestCount += 1;
    if (this.totalCost >= this.dailyLimit) {
      this.isExhausted = true;
      this.lastExhaustedTime = new Date().toISOString();
    }
  }
}
