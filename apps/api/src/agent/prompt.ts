import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readPromptFile(path: string): string | null {
  try {
    const prompt = readFileSync(path, "utf8").trim();
    return prompt || null;
  } catch {
    return null;
  }
}

function loadSoulPrompt(): string {
  const explicitSoulPath = process.env.ANIMA_SOUL_PATH;
  if (explicitSoulPath) {
    const prompt = readPromptFile(explicitSoulPath);
    if (prompt) return prompt;
  }

  const explicitSoulDir = process.env.ANIMA_SOUL_DIR;
  const soulCandidates = explicitSoulDir
    ? [resolve(explicitSoulDir, "soul.md")]
    : [
        resolve(process.cwd(), "soul", "soul.md"),
        resolve(process.cwd(), "../../soul/soul.md"),
      ];

  for (const path of soulCandidates) {
    const prompt = readPromptFile(path);
    if (prompt) return prompt;
  }

  const factoryCandidates = explicitSoulDir
    ? [resolve(explicitSoulDir, "factory.md")]
    : [
        resolve(process.cwd(), "soul", "factory.md"),
        resolve(process.cwd(), "../../soul/factory.md"),
      ];

  for (const path of factoryCandidates) {
    const prompt = readPromptFile(path);
    if (prompt) return prompt;
  }

  throw new Error(
    "No prompt file found. Expected soul.md, or fallback factory.md.",
  );
}

let cachedSoulPrompt: string | null = null;

export function getSoulPrompt(): string {
  if (!cachedSoulPrompt) {
    cachedSoulPrompt = loadSoulPrompt();
  }
  return cachedSoulPrompt;
}

export function invalidateSoulPromptCache(): void {
  cachedSoulPrompt = null;
}
