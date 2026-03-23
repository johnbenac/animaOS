/**
 * a-mod: Configuration Loader
 * 
 * Loads anima-mod.config.yaml with environment variable substitution.
 */

import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { ModConfig } from "./types.js";

interface AModConfig {
  modules?: ModConfig[];
  core?: {
    port?: number;
    hostname?: string;
    anima?: {
      baseUrl?: string;
      username?: string;
      password?: string;
    };
    store?: {
      path?: string;
    };
  };
  log?: {
    level?: string;
  };
}

let cachedConfig: AModConfig | null = null;

/**
 * Load a-mod configuration from YAML
 */
export async function loadConfig(path = "./anima-mod.config.yaml"): Promise<AModConfig> {
  if (cachedConfig) return cachedConfig;

  try {
    const content = await readFile(path, "utf-8");
    const substituted = substituteEnv(content);
    cachedConfig = parse(substituted) as AModConfig;
    return cachedConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Return default config if file not found
      return { modules: [] };
    }
    throw err;
  }
}

/**
 * Substitute environment variables in config
 * Supports: ${VAR} or ${VAR:-default}
 */
function substituteEnv(content: string): string {
  return content.replace(/\$\{([^}]+)\}/g, (match, expr) => {
    const [varName, defaultValue] = expr.split(":-");
    const value = process.env[varName];
    if (value !== undefined) return value;
    if (defaultValue !== undefined) return defaultValue;
    return match; // Keep original if not found and no default
  });
}

/**
 * Clear config cache (useful for testing)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}
