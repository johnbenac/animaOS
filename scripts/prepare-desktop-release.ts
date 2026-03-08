import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const tauriDir = join(repoRoot, "apps", "desktop", "src-tauri");
const binDir = join(tauriDir, "bin");

const apiBinaryName = process.platform === "win32"
  ? "anima-api.exe"
  : "anima-api";
const apiBinaryPath = join(binDir, apiBinaryName);

rmSync(binDir, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });

const compile = spawnSync(
  "bun",
  [
    "build",
    "apps/api/src/index.ts",
    "--compile",
    "--outfile",
    apiBinaryPath,
  ],
  { cwd: repoRoot, stdio: "inherit" },
);

if (compile.status !== 0) {
  process.exit(compile.status ?? 1);
}

if (!existsSync(apiBinaryPath)) {
  console.error(`API binary missing at ${apiBinaryPath}`);
  process.exit(1);
}

if (process.platform !== "win32") {
  chmodSync(apiBinaryPath, 0o755);
}

console.log(`Prepared API sidecar: ${apiBinaryPath}`);
