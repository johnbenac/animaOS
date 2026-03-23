/**
 * a-mod: Logger
 * 
 * Simple structured logging with pino.
 */

import pino from "pino";
import type { Logger } from "./types.js";

// Global logger instance
let rootLogger: pino.Logger | null = null;

function getRootLogger(): pino.Logger {
  if (!rootLogger) {
    rootLogger = pino({
      level: process.env.LOG_LEVEL ?? "info",
      transport: process.env.NODE_ENV === "development" 
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
    });
  }
  return rootLogger;
}

/**
 * Create a logger scoped to a module/component
 */
export function createLogger(name: string): Logger {
  const log = getRootLogger().child({ component: name });

  return {
    debug: (msg, meta) => log.debug(meta ?? {}, msg),
    info: (msg, meta) => log.info(meta ?? {}, msg),
    warn: (msg, meta) => log.warn(meta ?? {}, msg),
    error: (msg, meta) => log.error(meta ?? {}, msg),
  };
}

/**
 * Set global log level
 */
export function setLogLevel(level: string): void {
  getRootLogger().level = level;
}
