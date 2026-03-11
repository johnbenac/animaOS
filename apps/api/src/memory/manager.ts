import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { memoryChunks, type MemoryChunk } from "../db/schema";
import { maybeDecryptForUser } from "../lib/data-crypto";
import { USER_DATA_ROOT } from "../lib/runtime-paths";

const INDEX_DEBOUNCE_MS = 250;
const MAX_CHUNK_CHARS = 900;
const DEFAULT_MAX_RESULTS = 8;
const pendingIndexJobs = new Map<string, ReturnType<typeof setTimeout>>();

export interface MemorySearchResult {
  path: string;
  section: string;
  snippet: string;
  score: number;
}

interface SearchOptions {
  maxResults?: number;
  section?: string;
}

interface ChunkDraft {
  content: string;
  startLine: number;
  endLine: number;
  tokenCount: number;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return Array.from(new Set(normalizeText(value).split(" ").filter((term) => term.length >= 2)));
}

function ensureReadableMemory(userId: number, raw: string): string {
  const plaintext = maybeDecryptForUser(userId, raw);
  if (plaintext.startsWith("enc1:")) {
    throw new Error("Memory search requires an unlocked session.");
  }
  return plaintext;
}

function stripFrontmatter(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return match ? match[1] : raw;
}

function approxTokenCount(value: string): number {
  return Math.max(1, Math.ceil(value.trim().split(/\s+/).filter(Boolean).length * 1.3));
}

function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toSnippet(value: string, maxChars = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function buildChunks(content: string): ChunkDraft[] {
  const lines = content.split(/\r?\n/);
  const chunks: ChunkDraft[] = [];
  let buffer: string[] = [];
  let startLine = 1;
  let currentChars = 0;

  const flush = (endLine: number) => {
    const text = buffer.join("\n").trim();
    if (!text) {
      buffer = [];
      currentChars = 0;
      startLine = endLine + 1;
      return;
    }

    chunks.push({
      content: text,
      startLine,
      endLine,
      tokenCount: approxTokenCount(text),
    });
    buffer = [];
    currentChars = 0;
    startLine = endLine + 1;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    const nextChars = currentChars + line.length + 1;

    if (buffer.length > 0 && nextChars > MAX_CHUNK_CHARS) {
      flush(lineNumber - 1);
    }

    if (buffer.length === 0) {
      startLine = lineNumber;
    }

    buffer.push(line);
    currentChars += line.length + 1;

    if (line.trim() === "" && currentChars >= Math.floor(MAX_CHUNK_CHARS * 0.6)) {
      flush(lineNumber);
    }
  }

  if (buffer.length > 0) {
    flush(lines.length);
  }

  return chunks.length > 0
    ? chunks
    : [
        {
          content: content.trim(),
          startLine: 1,
          endLine: Math.max(1, lines.length),
          tokenCount: approxTokenCount(content),
        },
      ];
}

function normalizeRelativePath(userId: number, path: string, section?: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.md$/i, "");

  if (/^\d+\/memory\//.test(normalized)) {
    return `${normalized}.md`;
  }

  if (normalized.includes("/")) {
    return `${userId}/memory/${normalized}.md`;
  }

  if (!section) {
    throw new Error(`Cannot infer memory section for path "${path}"`);
  }

  return `${userId}/memory/${section}/${normalized}.md`;
}

function sectionFromPath(relativePath: string, fallback?: string): string {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length >= 4 && parts[1] === "memory") return parts[2];
  if (parts.length >= 2) return parts[0];
  return fallback || "knowledge";
}

function fileLabel(relativePath: string): string {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length >= 4 && parts[1] === "memory") {
    return `${parts[2]}/${parts.slice(3).join("/").replace(/\.md$/i, "")}`;
  }
  return relativePath.replace(/\.md$/i, "");
}

function scoreChunk(queryTerms: string[], normalizedQuery: string, content: string): number {
  const haystack = normalizeText(content);
  if (!haystack) return 0;

  let matchCount = 0;
  let totalHits = 0;
  for (const term of queryTerms) {
    if (!haystack.includes(term)) continue;
    matchCount++;
    totalHits += haystack.split(term).length - 1;
  }

  if (matchCount === 0) return 0;

  const overlap = matchCount / queryTerms.length;
  const phraseBoost = haystack.includes(normalizedQuery) ? 0.2 : 0;
  const densityBoost = Math.min(0.15, totalHits * 0.03);
  const prefixBoost = haystack.startsWith(normalizedQuery) ? 0.08 : 0;

  return Math.min(1, overlap * 0.72 + phraseBoost + densityBoost + prefixBoost);
}

async function readIndexedMemory(userId: number, relativePath: string): Promise<string> {
  const fullPath = join(USER_DATA_ROOT, relativePath);
  const raw = await readFile(fullPath, "utf-8");
  return stripFrontmatter(ensureReadableMemory(userId, raw));
}

async function replaceIndexedChunks(
  userId: number,
  relativePath: string,
  section: string,
): Promise<void> {
  const content = await readIndexedMemory(userId, relativePath);
  const chunks = buildChunks(content);
  const fileChecksum = checksum(content);

  await db
    .delete(memoryChunks)
    .where(and(eq(memoryChunks.userId, userId), eq(memoryChunks.sourcePath, relativePath)));

  if (chunks.length === 0) return;

  await db.insert(memoryChunks).values(
    chunks.map((chunk, chunkIndex) => ({
      userId,
      sourcePath: relativePath,
      section,
      chunkIndex,
      content: chunk.content,
      embedding: null,
      embeddingModel: null,
      tokenCount: chunk.tokenCount,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      checksum: fileChecksum,
    })),
  );
}

async function loadIndexedRows(userId: number, section?: string): Promise<MemoryChunk[]> {
  const rows = await db.select().from(memoryChunks).where(eq(memoryChunks.userId, userId));
  if (!section) return rows;
  return rows.filter((row) => row.section === section);
}

async function walkMemoryFiles(dir: string, prefix: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolute = join(dir, entry.name);
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await walkMemoryFiles(absolute, relative)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(relative.replace(/\\/g, "/"));
    }
  }

  return files;
}

export function scheduleIndex(userId: number, path: string, section?: string): void {
  const relativePath = normalizeRelativePath(userId, path, section);
  const resolvedSection = sectionFromPath(relativePath, section);
  const key = `${userId}:${relativePath}`;
  const existing = pendingIndexJobs.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingIndexJobs.delete(key);
    replaceIndexedChunks(userId, relativePath, resolvedSection).catch((err) => {
      console.warn(`[memory:index] Failed to index ${relativePath}: ${(err as Error).message}`);
    });
  }, INDEX_DEBOUNCE_MS);

  pendingIndexJobs.set(key, timer);
}

export async function removeFromIndex(userId: number, path: string, section?: string): Promise<void> {
  const relativePath = normalizeRelativePath(userId, path, section);
  const pending = pendingIndexJobs.get(`${userId}:${relativePath}`);
  if (pending) {
    clearTimeout(pending);
    pendingIndexJobs.delete(`${userId}:${relativePath}`);
  }

  await db
    .delete(memoryChunks)
    .where(and(eq(memoryChunks.userId, userId), eq(memoryChunks.sourcePath, relativePath)));
}

export async function reindexAll(userId: number): Promise<{ indexedFiles: number; failedFiles: string[] }> {
  const root = join(USER_DATA_ROOT, String(userId), "memory");
  let files: string[] = [];

  try {
    files = await walkMemoryFiles(root, `${userId}/memory`);
  } catch {
    return { indexedFiles: 0, failedFiles: [] };
  }

  const failedFiles: string[] = [];
  let indexedFiles = 0;

  for (const file of files) {
    try {
      await replaceIndexedChunks(userId, file, sectionFromPath(file));
      indexedFiles++;
    } catch {
      failedFiles.push(file);
    }
  }

  return { indexedFiles, failedFiles };
}

export async function semanticSearch(
  userId: number,
  query: string,
  options: SearchOptions = {},
): Promise<MemorySearchResult[]> {
  const normalizedQuery = normalizeText(query);
  const queryTerms = tokenize(query);
  if (!normalizedQuery || queryTerms.length === 0) return [];

  let rows = await loadIndexedRows(userId, options.section);
  if (rows.length === 0) {
    await reindexAll(userId);
    rows = await loadIndexedRows(userId, options.section);
  }

  const bestByPath = new Map<string, MemorySearchResult>();

  for (const row of rows) {
    const score = scoreChunk(queryTerms, normalizedQuery, row.content);
    if (score <= 0) continue;

    const next: MemorySearchResult = {
      path: row.sourcePath,
      section: row.section,
      snippet: toSnippet(row.content),
      score,
    };

    const current = bestByPath.get(row.sourcePath);
    if (!current || next.score > current.score) {
      bestByPath.set(row.sourcePath, next);
    }
  }

  return Array.from(bestByPath.values())
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, options.maxResults || DEFAULT_MAX_RESULTS);
}

export async function retrieveContextMemories(
  userId: number,
  query: string,
  maxTokens = 1200,
): Promise<string> {
  const maxResults = Math.max(3, Math.min(DEFAULT_MAX_RESULTS, Math.ceil(maxTokens / 220)));
  const results = await semanticSearch(userId, query, { maxResults });
  if (results.length === 0) return "";

  let usedTokens = 0;
  const sections: string[] = [];

  for (const result of results) {
    const block = `### ${fileLabel(result.path)}\n${result.snippet}`;
    const blockTokens = approxTokenCount(block);
    if (sections.length > 0 && usedTokens + blockTokens > maxTokens) break;
    usedTokens += blockTokens;
    sections.push(block);
  }

  if (sections.length === 0) return "";

  return [
    "# Relevant Memory Retrieval",
    "Use these notes only if they help answer the current conversation.",
    "Prefer concrete facts and recent context.",
    "",
    sections.join("\n\n"),
  ].join("\n");
}

export async function getIndexStats(
  userId: number,
): Promise<{ chunkCount: number; fileCount: number; sections: string[] }> {
  const rows = await loadIndexedRows(userId);
  return {
    chunkCount: rows.length,
    fileCount: new Set(rows.map((row) => row.sourcePath)).size,
    sections: Array.from(new Set(rows.map((row) => row.section))).sort(),
  };
}
