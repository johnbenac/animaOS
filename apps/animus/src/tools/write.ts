// apps/animus/src/tools/write.ts
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface WriteArgs {
  file_path: string;
  content: string;
}

export function executeWrite(args: WriteArgs): {
  status: "success" | "error";
  result: string;
} {
  const { file_path, content } = args;
  const dir = dirname(file_path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(file_path, content, "utf-8");
  return {
    status: "success",
    result: `Wrote ${content.length} chars to ${file_path}`,
  };
}
