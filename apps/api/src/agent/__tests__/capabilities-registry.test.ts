import { describe, expect, test } from "bun:test";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  buildCapabilityToolset,
  defineCapability,
} from "../capabilities/registry";
import type { ActionContract } from "../capabilities/types";

function createNamedTool(name: string) {
  return tool(async () => "ok", {
    name,
    description: `${name} tool`,
    schema: z.object({}),
  });
}

describe("capability registry", () => {
  test("builds toolset when contracts and tools align", () => {
    const alpha = createNamedTool("alpha");
    const beta = createNamedTool("beta");
    const actions: ActionContract[] = [
      { capabilityId: "demo", name: "alpha", summary: "alpha summary" },
      { capabilityId: "demo", name: "beta", summary: "beta summary" },
    ];

    const capability = defineCapability({
      id: "demo",
      summary: "demo capability",
      actions,
      tools: [alpha, beta],
    });

    const toolset = buildCapabilityToolset([capability]);
    expect(toolset.length).toBe(2);
    expect((toolset[0] as { name: string }).name).toBe("alpha");
    expect((toolset[1] as { name: string }).name).toBe("beta");
  });

  test("throws if a tool is missing an action contract", () => {
    const alpha = createNamedTool("alpha");

    expect(() =>
      defineCapability({
        id: "demo",
        summary: "demo capability",
        actions: [],
        tools: [alpha],
      }),
    ).toThrow('Missing action contract for tool "alpha"');
  });

  test("throws if a contract is missing a tool implementation", () => {
    expect(() =>
      defineCapability({
        id: "demo",
        summary: "demo capability",
        actions: [
          {
            capabilityId: "demo",
            name: "alpha",
            summary: "alpha summary",
          },
        ],
        tools: [],
      }),
    ).toThrow('Contract "alpha" has no matching tool implementation');
  });

  test("throws on duplicate tool names across capabilities", () => {
    const alphaA = createNamedTool("alpha");
    const alphaB = createNamedTool("alpha");

    const capA = defineCapability({
      id: "a",
      summary: "a",
      actions: [{ capabilityId: "a", name: "alpha", summary: "alpha" }],
      tools: [alphaA],
    });
    const capB = defineCapability({
      id: "b",
      summary: "b",
      actions: [{ capabilityId: "b", name: "alpha", summary: "alpha" }],
      tools: [alphaB],
    });

    expect(() => buildCapabilityToolset([capA, capB])).toThrow(
      'Duplicate tool name across capabilities: "alpha"',
    );
  });
});
