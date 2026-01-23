import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { DatabaseManager } from "../src/utils/database.js";

const TEST_DB = ".test_trading_system.db";

describe("DatabaseManager", () => {
  let db: DatabaseManager;

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = new DatabaseManager(TEST_DB);
    await db.initialize();
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("upserts and retrieves markets", () => {
    const ts = Math.floor(Date.now() / 1000) + 86400 * 3;
    db.upsertMarket({
      market_id: "KXTEST-1",
      title: "Test market",
      yes_price: 0.55,
      no_price: 0.45,
      volume: 1000,
      expiration_ts: ts,
      category: "TEST",
      status: "open",
      last_updated: new Date().toISOString(),
    });
    const eligible = db.getEligibleMarkets(500, 14);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].market_id).toBe("KXTEST-1");
  });

  it("inserts and retrieves positions, closes them", () => {
    const id = db.insertPosition({
      market_id: "KXT",
      side: "YES",
      entry_price: 0.5,
      quantity: 10,
      timestamp: new Date().toISOString(),
      confidence: 0.7,
      status: "open",
    });
    expect(db.getOpenPositions()).toHaveLength(1);
    db.closePosition(id, 0.7, 2.0, new Date().toISOString());
    expect(db.getOpenPositions()).toHaveLength(0);
    expect(db.getTradeLogs()).toHaveLength(1);
  });
});
