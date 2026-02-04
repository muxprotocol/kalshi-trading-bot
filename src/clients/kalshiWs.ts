import WebSocket from "ws";
import crypto from "node:crypto";
import fs from "node:fs";
import { settings } from "../config/settings.js";
import { getLogger } from "../utils/logger.js";

const logger = getLogger("kalshiWs");

export type WsEventHandler = (event: Record<string, unknown>) => void | Promise<void>;

export class KalshiWebSocketClient {
  private ws: WebSocket | null = null;
  private subscriptions = new Map<string, WsEventHandler>();
  private privateKey: crypto.KeyObject | null = null;
  private apiKey: string;
  private wsUrl: string;
  private shouldReconnect = true;
  private reconnectDelayMs = 2000;

  constructor(apiKey?: string, privateKeyPath?: string) {
    this.apiKey = apiKey ?? settings.api.kalshiApiKey;
    this.wsUrl = "wss://api.elections.kalshi.com/trade-api/ws/v2";
    const keyPath = privateKeyPath ?? process.env.KALSHI_PRIVATE_KEY_PATH ?? "kalshi_private_key.pem";
    if (fs.existsSync(keyPath)) {
      this.privateKey = crypto.createPrivateKey({ key: fs.readFileSync(keyPath), format: "pem" });
    }
  }

  private sign(timestamp: string, method: string, path: string): string {
    if (!this.privateKey) throw new Error("No private key");
    return crypto
      .sign("sha256", Buffer.from(timestamp + method + path), {
        key: this.privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      })
      .toString("base64");
  }

  async connect(): Promise<void> {
    const timestamp = Date.now().toString();
    const signature = this.sign(timestamp, "GET", "/trade-api/ws/v2");
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, {
        headers: {
          "KALSHI-ACCESS-KEY": this.apiKey,
          "KALSHI-ACCESS-TIMESTAMP": timestamp,
          "KALSHI-ACCESS-SIGNATURE": signature,
        },
      });
      this.ws.on("open", () => {
        logger.info("WebSocket connected");
        resolve();
      });
      this.ws.on("error", (err) => {
        logger.error({ err: err.message }, "WebSocket error");
        reject(err);
      });
      this.ws.on("close", () => {
        logger.warn("WebSocket closed");
        if (this.shouldReconnect) {
          setTimeout(() => this.connect().catch(() => {}), this.reconnectDelayMs);
        }
      });
      this.ws.on("message", (data) => this.handleMessage(data.toString()));
    });
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as Record<string, unknown>;
      const channel = String(msg.channel ?? msg.type ?? "");
      const handler = this.subscriptions.get(channel);
      if (handler) void handler(msg);
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "Failed to parse WS message");
    }
  }

  subscribe(channel: string, tickers: string[], handler: WsEventHandler): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.subscriptions.set(channel, handler);
    this.ws.send(
      JSON.stringify({
        id: Math.floor(Math.random() * 1e9),
        cmd: "subscribe",
        params: { channels: [channel], market_tickers: tickers },
      })
    );
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close();
  }
}
