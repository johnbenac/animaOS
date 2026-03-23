// apps/animus/src/tools/glob.ts
import { Glob } from "bun";

export interface GlobArgs {
  pattern: string;
  path?: string;
}

export function executeGlob(args: GlobArgs): {
  status: "success" | "error";
  result: string;
} {
  const { pattern, path = "." } = args;
  const glob = new Glob(pattern);
  const matches = [...glob.scanSync({ cwd: path })];
  if (matches.length === 0) {
    return { status: "success", result: "No files found" };
  }
  return { status: "success", result: matches.join("\n") };
}
