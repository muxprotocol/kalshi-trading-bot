import type { KalshiClient } from "../clients/kalshiClient.js";
import { getLogger } from "./logger.js";

const logger = getLogger("cashReserves");

export interface ReserveStatus {
  balance: number;
  reservedCash: number;
  availableCash: number;
  reservePct: number;
}

export class CashReserveManager {
  constructor(
    private client: KalshiClient,
    public reservePct = 0.15
  ) {}

  async getStatus(): Promise<ReserveStatus> {
    const resp = await this.client.getBalance();
    const balanceCents = Number(resp.balance ?? 0);
    const balance = balanceCents / 100;
    const reservedCash = balance * this.reservePct;
    const availableCash = Math.max(0, balance - reservedCash);
    return { balance, reservedCash, availableCash, reservePct: this.reservePct };
  }

  async canAllocate(amount: number): Promise<boolean> {
    const s = await this.getStatus();
    if (amount > s.availableCash) {
      logger.warn({ amount, availableCash: s.availableCash }, "Allocation would breach reserves");
      return false;
    }
    return true;
  }
}
