import crypto from "node:crypto";
import fs from "node:fs";
import axios, { type AxiosInstance, AxiosError } from "axios";
import { settings } from "../config/settings.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("kalshiClient");

export class KalshiAPIError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "KalshiAPIError";
  }
}

export interface PlaceOrderParams {
  ticker: string;
  clientOrderId: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  count: number;
  type?: "market" | "limit";
  yesPrice?: number;
  noPrice?: number;
  expirationTs?: number;
}

export class KalshiClient {
  private baseUrl: string;
  private apiKey: string;
  private privateKeyPath: string;
  private privateKey: crypto.KeyObject | null = null;
  private http: AxiosInstance;
  private maxRetries: number;
  private backoffFactor: number;

  constructor(opts: { apiKey?: string; privateKeyPath?: string; maxRetries?: number; backoffFactor?: number } = {}) {
    this.apiKey = opts.apiKey ?? settings.api.kalshiApiKey;
    this.baseUrl = settings.api.kalshiBaseUrl;
    this.privateKeyPath = opts.privateKeyPath ?? process.env.KALSHI_PRIVATE_KEY_PATH ?? "kalshi_private_key.pem";
    this.maxRetries = opts.maxRetries ?? 5;
    this.backoffFactor = opts.backoffFactor ?? 0.5;
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30_000,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    this.loadPrivateKey();
    logger.info({ apiKeyLen: this.apiKey.length }, "Kalshi client initialized");
  }

  private loadPrivateKey(): void {
    try {
      if (!fs.existsSync(this.privateKeyPath)) {
        logger.warn({ path: this.privateKeyPath }, "Private key file not found — authenticated calls will fail");
        return;
      }
      const pem = fs.readFileSync(this.privateKeyPath);
      this.privateKey = crypto.createPrivateKey({ key: pem, format: "pem" });
      logger.info("Private key loaded");
    } catch (e) {
      logger.error({ err: (e as Error).message }, "Failed to load private key");
    }
  }

  private signRequest(timestamp: string, method: string, path: string): string {
    if (!this.privateKey) throw new KalshiAPIError("No private key loaded");
    const message = Buffer.from(timestamp + method.toUpperCase() + path, "utf8");
    const signature = crypto.sign(
      "sha256",
      message,
      {
        key: this.privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      }
    );
    return signature.toString("base64");
  }

  private buildAuthHeaders(method: string, endpoint: string): Record<string, string> {
    const timestamp = Date.now().toString();
    const signature = this.signRequest(timestamp, method, endpoint);
    return {
      "KALSHI-ACCESS-KEY": this.apiKey,
      "KALSHI-ACCESS-TIMESTAMP": timestamp,
      "KALSHI-ACCESS-SIGNATURE": signature,
    };
  }

  private async request<T = unknown>(
    method: "GET" | "POST" | "DELETE" | "PUT",
    endpoint: string,
    opts: { params?: Record<string, unknown>; data?: unknown; auth?: boolean } = {}
  ): Promise<T> {
    const { params, data, auth = true } = opts;
    const headers: Record<string, string> = {};
    if (auth) Object.assign(headers, this.buildAuthHeaders(method, endpoint));

    let lastErr: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        await new Promise((r) => setTimeout(r, 200));
        const resp = await this.http.request<T>({ method, url: endpoint, params, data, headers });
        return resp.data;
      } catch (err) {
        lastErr = err;
        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          if (status === 429 || (status && status >= 500)) {
            const delay = this.backoffFactor * 2 ** attempt * 1000;
            logger.warn({ status, endpoint, attempt }, `API request failed, retrying in ${delay}ms`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw new KalshiAPIError(
            `HTTP ${status}: ${JSON.stringify(err.response?.data ?? err.message)}`,
            status
          );
        }
        await new Promise((r) => setTimeout(r, this.backoffFactor * 2 ** attempt * 1000));
      }
    }
    throw new KalshiAPIError(`API request failed after ${this.maxRetries} retries: ${(lastErr as Error)?.message}`);
  }

  // Portfolio
  async getBalance(): Promise<Record<string, any>> {
    return this.request("GET", "/trade-api/v2/portfolio/balance");
  }

  async getPositions(ticker?: string): Promise<Record<string, any>> {
    return this.request("GET", "/trade-api/v2/portfolio/positions", { params: ticker ? { ticker } : undefined });
  }

  async getFills(ticker?: string, limit = 100): Promise<Record<string, any>> {
    return this.request("GET", "/trade-api/v2/portfolio/fills", { params: { limit, ...(ticker ? { ticker } : {}) } });
  }

  async getOrders(ticker?: string, status?: string): Promise<Record<string, any>> {
    const params: Record<string, unknown> = {};
    if (ticker) params.ticker = ticker;
    if (status) params.status = status;
    return this.request("GET", "/trade-api/v2/portfolio/orders", { params });
  }

  // Markets
  async getMarkets(opts: {
    limit?: number;
    cursor?: string;
    eventTicker?: string;
    seriesTicker?: string;
    status?: string;
    tickers?: string[];
  } = {}): Promise<Record<string, any>> {
    const params: Record<string, unknown> = { limit: opts.limit ?? 100 };
    if (opts.cursor) params.cursor = opts.cursor;
    if (opts.eventTicker) params.event_ticker = opts.eventTicker;
    if (opts.seriesTicker) params.series_ticker = opts.seriesTicker;
    if (opts.status) params.status = opts.status;
    if (opts.tickers) params.tickers = opts.tickers.join(",");
    return this.request("GET", "/trade-api/v2/markets", { params });
  }

  async getMarket(ticker: string): Promise<Record<string, any>> {
    return this.request("GET", `/trade-api/v2/markets/${ticker}`, { auth: false });
  }

  async getOrderbook(ticker: string, depth = 100): Promise<Record<string, any>> {
    return this.request("GET", `/trade-api/v2/markets/${ticker}/orderbook`, {
      params: { depth },
      auth: false,
    });
  }

  async getMarketHistory(ticker: string, startTs?: number, endTs?: number, limit = 100): Promise<Record<string, any>> {
    const params: Record<string, unknown> = { limit };
    if (startTs) params.start_ts = startTs;
    if (endTs) params.end_ts = endTs;
    return this.request("GET", `/trade-api/v2/markets/${ticker}/history`, { params, auth: false });
  }

  async placeOrder(p: PlaceOrderParams): Promise<Record<string, any>> {
    const body: Record<string, unknown> = {
      ticker: p.ticker,
      client_order_id: p.clientOrderId,
      side: p.side,
      action: p.action,
      count: p.count,
      type: p.type ?? "market",
    };
    if (p.yesPrice !== undefined) body.yes_price = p.yesPrice;
    if (p.noPrice !== undefined) body.no_price = p.noPrice;
    if (p.expirationTs !== undefined) body.expiration_ts = p.expirationTs;
    return this.request("POST", "/trade-api/v2/portfolio/orders", { data: body });
  }

  async cancelOrder(orderId: string): Promise<Record<string, any>> {
    return this.request("DELETE", `/trade-api/v2/portfolio/orders/${orderId}`);
  }

  async close(): Promise<void> {
    // axios has no persistent connection to close; stub for parity
  }
}
