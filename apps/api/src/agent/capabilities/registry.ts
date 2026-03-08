import type { StructuredToolInterface } from "@langchain/core/tools";
import type { CapabilityDefinition } from "./types";

function getToolName(tool: StructuredToolInterface): string {
  const raw = (tool as { name?: unknown }).name;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Capability tool is missing a valid name.");
  }
  return raw;
}

export function defineCapability(
  capability: CapabilityDefinition,
): CapabilityDefinition {
  const contractNames = new Set(capability.actions.map((action) => action.name));
  const toolNames = capability.tools.map((tool) => getToolName(tool));
  const uniqueToolNames = new Set(toolNames);

  if (uniqueToolNames.size !== toolNames.length) {
    throw new Error(
      `[capability:${capability.id}] Duplicate tool names found in capability definition.`,
    );
  }

  for (const name of toolNames) {
    if (!contractNames.has(name)) {
      throw new Error(
        `[capability:${capability.id}] Missing action contract for tool "${name}".`,
      );
    }
  }

  for (const name of contractNames) {
    if (!uniqueToolNames.has(name)) {
      throw new Error(
        `[capability:${capability.id}] Contract "${name}" has no matching tool implementation.`,
      );
    }
  }

  return capability;
}

export function buildCapabilityToolset(
  capabilities: CapabilityDefinition[],
): StructuredToolInterface[] {
  const seenNames = new Set<string>();
  const output: StructuredToolInterface[] = [];

  for (const capability of capabilities) {
    for (const tool of capability.tools) {
      const name = getToolName(tool);
      if (seenNames.has(name)) {
        throw new Error(`Duplicate tool name across capabilities: "${name}".`);
      }
      seenNames.add(name);
      output.push(tool);
    }
  }

  return output;
}
