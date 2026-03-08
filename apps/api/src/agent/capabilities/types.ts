import type { StructuredToolInterface } from "@langchain/core/tools";

export interface ActionContract {
  capabilityId: string;
  name: string;
  summary: string;
}

export interface CapabilityDefinition {
  id: string;
  summary: string;
  actions: ActionContract[];
  tools: StructuredToolInterface[];
}
