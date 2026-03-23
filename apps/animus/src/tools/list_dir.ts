// apps/animus/src/tools/list_dir.ts
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ListDirArgs {
  path: string;
}

export function executeListDir(args: ListDirArgs): {
  status: "success" | "error";
  result: string;
} {
  const { path } = args;
  if (!existsSync(path)) {
    return { status: "error", result: `Directory not found: ${path}` };
  }
  const entries = readdirSync(path);
  const lines = entries.map((name) => {
    const stat = statSync(join(path, name));
    const prefix = stat.isDirectory() ? "[dir]  " : "[file] ";
    return `${prefix}${name}`;
  });
  return { status: "success", result: lines.join("\n") };
}
