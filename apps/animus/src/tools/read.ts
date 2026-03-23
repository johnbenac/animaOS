// apps/animus/src/tools/read.ts
import { readFileSync, existsSync } from "node:fs";

export interface ReadArgs {
  file_path: string;
  offset?: number;
  limit?: number;
}

export function executeRead(args: ReadArgs): {
  status: "success" | "error";
  result: string;
} {
  const { file_path, offset = 0, limit = 2000 } = args;
  if (!existsSync(file_path)) {
    return { status: "error", result: `File not found: ${file_path}` };
  }
  const content = readFileSync(file_path, "utf-8");
  const lines = content.split("\n");
  const sliced = lines.slice(offset, offset + limit);
  const numbered = sliced.map(
    (line, i) => `${String(offset + i + 1).padStart(6)}| ${line}`,
  );
  return { status: "success", result: numbered.join("\n") };
}
