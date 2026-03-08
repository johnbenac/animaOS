import type { StructuredToolInterface } from "@langchain/core/tools";
import { buildCapabilityToolset, defineCapability } from "./registry";
import type { CapabilityDefinition } from "./types";

export interface CapabilityRuntimeContext {
  userId: number;
}

export interface CapabilityPlugin {
  id: string;
  setup?: () => void;
  capabilities: (
    context: CapabilityRuntimeContext,
  ) => CapabilityDefinition[];
}

export interface CapabilityRuntime {
  getRegisteredPlugins: () => readonly CapabilityPlugin[];
  register: (plugin: CapabilityPlugin) => boolean;
  buildToolset: (
    context: CapabilityRuntimeContext,
    coreCapabilities: CapabilityDefinition[],
  ) => StructuredToolInterface[];
}

export interface CapabilityRuntimeDeps {
  initialPlugins?: readonly CapabilityPlugin[];
}

export function createCapabilityRuntime(
  deps: CapabilityRuntimeDeps = {},
): CapabilityRuntime {
  const plugins: CapabilityPlugin[] = [...(deps.initialPlugins ?? [])];
  const setupDone = new Set<string>();

  function runSetup(plugin: CapabilityPlugin): void {
    if (!plugin.setup || setupDone.has(plugin.id)) return;
    plugin.setup();
    setupDone.add(plugin.id);
  }

  function register(plugin: CapabilityPlugin): boolean {
    if (plugins.some((existing) => existing.id === plugin.id)) return false;
    plugins.push(plugin);
    return true;
  }

  function buildToolset(
    context: CapabilityRuntimeContext,
    coreCapabilities: CapabilityDefinition[],
  ): StructuredToolInterface[] {
    const combined: CapabilityDefinition[] = [...coreCapabilities];

    for (const plugin of plugins) {
      runSetup(plugin);
      const pluginCapabilities = plugin.capabilities(context);
      for (const capability of pluginCapabilities) {
        combined.push(defineCapability(capability));
      }
    }

    return buildCapabilityToolset(combined);
  }

  return {
    getRegisteredPlugins: () => plugins,
    register,
    buildToolset,
  };
}

export const defaultCapabilityRuntime = createCapabilityRuntime();

export function registerCapabilityPlugin(plugin: CapabilityPlugin): boolean {
  return defaultCapabilityRuntime.register(plugin);
}
