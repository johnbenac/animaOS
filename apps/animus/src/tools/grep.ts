// apps/animus/src/tools/grep.ts
import { execSync } from "node:child_process";

export interface GrepArgs {
  pattern: string;
  path?: string;
  include?: string;
}

export function executeGrep(args: GrepArgs): {
  status: "success" | "error";
  result: string;
} {
  const { pattern, path = ".", include } = args;
  try {
    const globFlag = include ? `--glob '${include}'` : "";
    const output = execSync(
      `rg --line-number --no-heading ${globFlag} '${pattern}' '${path}'`,
      { encoding: "utf-8", maxBuffer: 1024 * 1024, timeout: 30000 },
    );
    return { status: "success", result: output.slice(0, 50000) };
  } catch (err: unknown) {
    const execErr = err as { status?: number; message?: string };
    if (execErr.status === 1)
      return { status: "success", result: "No matches found" };
    return { status: "error", result: execErr.message ?? String(err) };
  }
}
