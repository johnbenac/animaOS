/**
 * anima-mod: Elysia Server
 * 
 * Creates and configures the Elysia server with all module routes.
 */

import { Elysia } from "elysia";
import { ModRegistry } from "./core/registry.js";
import { createLogger } from "./core/logger.js";

const logger = createLogger("server");

export interface ServerOptions {
  port: number;
  hostname: string;
}

export async function createServer(opts: ServerOptions): Promise<Elysia> {
  const app = new Elysia();

  // Health check
  app.get("/", () => ({
    name: "anima-mod",
    version: "0.1.0",
    status: "running",
  }));

  app.get("/health", () => ({
    status: "healthy",
    service: "anima-mod",
    timestamp: new Date().toISOString(),
  }));

  // Load and register modules
  const registry = new ModRegistry();
  
  logger.info("Loading modules...");
  await registry.loadFromConfig();
  
  logger.info("Initializing modules...");
  await registry.initAll();

  // Mount module routes
  const modServer = registry.getServer();
  app.use(modServer);

  // Start modules after server is ready
  logger.info("Starting modules...");
  await registry.startAll();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await registry.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return app;
}
