import { describe, expect, test } from "bun:test";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createCapabilityRuntime } from "../capabilities/runtime";
import { defineCapability } from "../capabilities/registry";

function createNamedTool(name: string) {
  return tool(async () => "ok", {
    name,
    description: `${name} tool`,
    schema: z.object({}),
  });
}

describe("capability runtime", () => {
  test("register returns false for duplicate plugin id", () => {
    const runtime = createCapabilityRuntime();

    const plugin = {
      id: "demo",
      capabilities: () => [],
    };

    expect(runtime.register(plugin)).toBe(true);
    expect(runtime.register(plugin)).toBe(false);
  });

  test("buildToolset merges core and plugin capabilities", () => {
    const runtime = createCapabilityRuntime();
    const coreTool = createNamedTool("core_action");
    const pluginTool = createNamedTool("plugin_action");

    runtime.register({
      id: "plugin-a",
      capabilities: () => [
        defineCapability({
          id: "plugin-cap",
          summary: "plugin capability",
          actions: [
            {
              capabilityId: "plugin-cap",
              name: "plugin_action",
              summary: "plugin action",
            },
          ],
          tools: [pluginTool],
        }),
      ],
    });

    const toolset = runtime.buildToolset(
      { userId: 1 },
      [
        defineCapability({
          id: "core-cap",
          summary: "core capability",
          actions: [
            {
              capabilityId: "core-cap",
              name: "core_action",
              summary: "core action",
            },
          ],
          tools: [coreTool],
        }),
      ],
    );

    const names = toolset.map((t) => (t as { name: string }).name);
    expect(names).toEqual(["core_action", "plugin_action"]);
  });

  test("plugin setup runs once even across multiple builds", () => {
    const runtime = createCapabilityRuntime();
    const pluginTool = createNamedTool("plugin_action");
    let setupCount = 0;

    runtime.register({
      id: "plugin-a",
      setup: () => {
        setupCount += 1;
      },
      capabilities: () => [
        defineCapability({
          id: "plugin-cap",
          summary: "plugin capability",
          actions: [
            {
              capabilityId: "plugin-cap",
              name: "plugin_action",
              summary: "plugin action",
            },
          ],
          tools: [pluginTool],
        }),
      ],
    });

    runtime.buildToolset({ userId: 1 }, []);
    runtime.buildToolset({ userId: 2 }, []);

    expect(setupCount).toBe(1);
  });
});
