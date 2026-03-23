// apps/animus/src/tools/ask_user.ts

export interface AskUserArgs {
  question: string;
}

export async function executeAskUser(
  _args: AskUserArgs,
): Promise<{ status: "success" | "error"; result: string }> {
  // Placeholder — real implementation connects to TUI in Task 8
  return { status: "error", result: "ask_user not available in headless mode" };
}
