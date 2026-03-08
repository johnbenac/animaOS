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

function resolvePromptTemplatePath(name: string): string[] {
  const explicitPromptsDir = process.env.ANIMA_PROMPTS_DIR;
  const filename = name.endsWith(".md") || name.endsWith(".txt")
    ? name
    : `${name}.md`;

  if (explicitPromptsDir) {
    return [resolve(explicitPromptsDir, filename)];
  }

  return [
    resolve(process.cwd(), "prompts", filename),
    resolve(process.cwd(), "apps", "api", "prompts", filename),
    resolve(process.cwd(), "../../apps/api/prompts", filename),
  ];
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
const promptTemplateCache = new Map<string, string>();

export function getSoulPrompt(): string {
  if (!cachedSoulPrompt) {
    cachedSoulPrompt = loadSoulPrompt();
  }
  return cachedSoulPrompt;
}

export function getPromptTemplate(name: string): string {
  const cached = promptTemplateCache.get(name);
  if (cached) return cached;

  const candidates = resolvePromptTemplatePath(name);
  for (const path of candidates) {
    const prompt = readPromptFile(path);
    if (prompt) {
      promptTemplateCache.set(name, prompt);
      return prompt;
    }
  }

  throw new Error(
    `No prompt template found for "${name}". Checked: ${candidates.join(", ")}`,
  );
}

export function renderPromptTemplate(
  name: string,
  variables: Record<string, string>,
): string {
  const template = getPromptTemplate(name);
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) =>
    variables[key] ?? "",
  );
}

export function invalidateSoulPromptCache(): void {
  cachedSoulPrompt = null;
  promptTemplateCache.clear();
}
