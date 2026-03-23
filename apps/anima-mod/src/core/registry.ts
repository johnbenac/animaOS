/**
 * a-mod: Module Registry
 * 
 * Loads, initializes, and manages module lifecycle.
 */

import { Elysia } from "elysia";
import type { AnyElysia } from "elysia";
import type { Mod, ModConfig, ModContext, ModManifest } from "./types.js";
import { createModContext } from "./context.js";
import { createLogger } from "./logger.js";
import { loadConfig } from "./config.js";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const logger = createLogger("registry");

interface LoadedMod {
  config: ModConfig;
  manifest?: ModManifest;
  mod?: Mod;
  ctx?: ModContext;
  router?: AnyElysia;
}

export class ModRegistry {
  private mods = new Map<string, LoadedMod>();
  private app = new Elysia();

  /**
   * Load all modules from anima-mod.config.yaml
   */
  async loadFromConfig(): Promise<void> {
    const config = await loadConfig();
    
    logger.info("Loading modules from config", { 
      count: config.modules?.length ?? 0 
    });

    for (const modConfig of config.modules ?? []) {
      await this.register(modConfig);
    }
  }

  /**
   * Register a single module
   */
  async register(modConfig: ModConfig): Promise<void> {
    const { id, path: modPath } = modConfig;

    if (this.mods.has(id)) {
      throw new Error(`Module ${id} already registered`);
    }

    logger.info("Registering module", { id, path: modPath });

    try {
      // Resolve path relative to project root
      const resolvedPath = resolve(modPath);
      const modUrl = pathToFileURL(join(resolvedPath, "mod.ts")).href;

      // Dynamic import
      const modModule = await import(modUrl);
      const mod: Mod = modModule.default ?? modModule.mod;

      if (!mod || typeof mod.init !== "function") {
        throw new Error(`Module ${id} does not export a valid Mod`);
      }

      // Validate ID matches
      if (mod.id !== id) {
        logger.warn(`Module ID mismatch: config says "${id}", mod exports "${mod.id}"`);
      }

      this.mods.set(id, {
        config: modConfig,
        mod,
      });

      logger.info("Module registered", { id, version: mod.version });
    } catch (err) {
      logger.error(`Failed to register module ${id}`, { 
        error: err instanceof Error ? err.message : String(err) 
      });
      throw err;
    }
  }

  /**
   * Initialize all registered modules
   */
  async initAll(): Promise<void> {
    logger.info("Initializing modules", { count: this.mods.size });

    // Sort by dependencies (simple version - no complex DAG for now)
    const sortedIds = this.sortByDependencies();

    for (const id of sortedIds) {
      const loaded = this.mods.get(id)!;
      
      try {
        const ctx = await createModContext(id, loaded.config.config);
        loaded.ctx = ctx;
        
        await loaded.mod!.init(ctx);
        
        // Get router if provided
        if (loaded.mod!.getRouter) {
          loaded.router = loaded.mod!.getRouter();
        }

        logger.info("Module initialized", { id });
      } catch (err) {
        logger.error(`Failed to initialize module ${id}`, { 
          error: err instanceof Error ? err.message : String(err) 
        });
        throw err;
      }
    }
  }

  /**
   * Start all initialized modules
   */
  async startAll(): Promise<void> {
    logger.info("Starting modules");

    for (const [id, loaded] of this.mods) {
      if (!loaded.mod) continue;

      try {
        await loaded.mod.start();
        logger.info("Module started", { id });
      } catch (err) {
        logger.error(`Failed to start module ${id}`, { 
          error: err instanceof Error ? err.message : String(err) 
        });
        // Continue starting other modules
      }
    }
  }

  /**
   * Stop all modules gracefully
   */
  async stopAll(): Promise<void> {
    logger.info("Stopping modules");

    for (const [id, loaded] of this.mods) {
      if (!loaded.mod?.stop) continue;

      try {
        await loaded.mod.stop();
        logger.info("Module stopped", { id });
      } catch (err) {
        logger.error(`Error stopping module ${id}`, { 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    }
  }

  /**
   * Get combined Elysia app with all module routes mounted
   */
  getServer(): Elysia {
    // Mount each module's router under /{id} prefix
    for (const [id, loaded] of this.mods) {
      if (loaded.router) {
        const prefixed = new Elysia({ prefix: `/${id}` }).use(loaded.router);
        this.app.use(prefixed);
        logger.debug("Mounted router", { id, prefix: `/${id}` });
      }
    }

    return this.app;
  }

  /**
   * Get a loaded module by ID
   */
  get(id: string): Mod | undefined {
    return this.mods.get(id)?.mod;
  }

  /**
   * List all loaded module IDs
   */
  list(): string[] {
    return Array.from(this.mods.keys());
  }

  /**
   * Simple dependency sort (modules with no deps first)
   */
  private sortByDependencies(): string[] {
    // TODO: Implement proper topological sort for dependencies
    return Array.from(this.mods.keys());
  }
}
