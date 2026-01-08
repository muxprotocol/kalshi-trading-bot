import pino, { type Logger } from "pino";
import { settings } from "../config/settings.js";

const level = settings.logging.level || "info";

export const rootLogger: Logger = pino({
  level,
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
});

export function getLogger(name: string): Logger {
  return rootLogger.child({ component: name });
}

export function getTradingLogger(name: string): Logger {
  return getLogger(name);
}

export function setupLogging(logLevel?: string): void {
  if (logLevel) rootLogger.level = logLevel.toLowerCase();
}

export function logErrorWithContext(
  logger: Logger,
  message: string,
  err: unknown,
  context: Record<string, unknown> = {}
): void {
  const e = err as Error;
  logger.error({ ...context, err: { message: e?.message, stack: e?.stack } }, message);
}
