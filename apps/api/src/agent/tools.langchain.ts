// Agent tools — LangChain @tool format for LangGraph
// Memory is now stored as markdown files in /memory at the project root.

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { syncReminderJobsForTask } from "../cron/task-reminders";

import {
  writeMemory,
  appendMemory,
  readMemory,
  deleteMemory,
  searchMemories,
  listMemories as listMemoryFiles,
  listAllMemories,
  writeJournalEntry,
  type MemorySection,
} from "../memory";

// Each tool receives userId via closure when created.
// This keeps the LangChain tool interface clean (no userId param exposed to the LLM).

// Map memory categories to filesystem sections
function categoryToSection(category: string): MemorySection {
  switch (category.toLowerCase()) {
    case "fact":
    case "preference":
    case "goal":
      return "user";
    case "relationship":
      return "relationships";
    case "note":
      return "knowledge";
    default:
      return normalizeSectionName(category);
  }
}

// Derive a reasonable filename from content
function contentToFilename(content: string, category: string): string {
  // Extract first meaningful words for filename
  const words = content
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join("-")
    .toLowerCase();

  return words || category;
}

function normalizeSectionName(raw: string): string {
  const section = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return section || "knowledge";
}

function parseMemoryPath(file: string): {
  section: MemorySection;
  filename: string;
} {
  const normalized = file.trim().replace(/^\/+/, "").replace(/\.md$/i, "");
  const parts = normalized.split("/").filter(Boolean);
  const section = normalizeSectionName(parts[0] || "");
  const filename = parts.slice(1).join("/");

  if (!filename) {
    throw new Error("Missing filename in path. Use format section/filename.");
  }

  return { section, filename };
}


function parseCurrentFocus(content: string): string {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === "---" || line.startsWith("#")) continue;

    const checklist = line.match(/^- \[(?: |x|X)\]\s+(.+)$/);
    if (checklist) return checklist[1].trim();

    const bullet = line.match(/^- (.+)$/);
    if (bullet) return bullet[1].trim();

    return line;
  }

  return "";
}

function renderCurrentFocus(focus: string, note?: string): string {
  const lines = ["# Current Focus", "", `- [ ] ${focus.trim()}`];

  if (note?.trim()) {
    lines.push("", "## Note", note.trim());
  }

  return lines.join("\n");
}

/**
 * Fallback: extract a due date/time from task text when the LLM forgets to set dueDate.
 * Handles patterns like "at 5:30 pm", "at 9pm", "at 17:00" combined with "today"/"tomorrow".
 */
/** Format a Date as local ISO without timezone offset issues */
function formatLocalISO(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

/**
 * Fallback: extract a due date/time from task text when the LLM forgets to set dueDate.
 * Handles patterns like "at 5:30 pm", "in 2 hours", "tonight", "next Monday", "March 10", etc.
 */
function extractDueDateFromText(text: string): string | null {
  const lower = text.toLowerCase();
  const now = new Date();
  const date = new Date(now);

  // --- "in X hours/minutes" ---
  const relativeMatch = lower.match(/in\s+(\d+)\s*(hours?|hrs?|minutes?|mins?)/);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    if (unit.startsWith("h")) {
      date.setTime(date.getTime() + amount * 60 * 60_000);
    } else {
      date.setTime(date.getTime() + amount * 60_000);
    }
    return formatLocalISO(date);
  }

  // --- "tonight" / "this evening" ---
  if (lower.includes("tonight") || lower.includes("this evening")) {
    date.setHours(20, 0, 0, 0);
    if (date.getTime() <= now.getTime()) {
      date.setDate(date.getDate() + 1);
    }
    return formatLocalISO(date);
  }

  // --- "next week" ---
  if (/\bnext\s+week\b/.test(lower)) {
    const daysUntilMonday = ((1 - now.getDay()) + 7) % 7 || 7;
    date.setDate(date.getDate() + daysUntilMonday);
    date.setHours(9, 0, 0, 0);
    return formatLocalISO(date);
  }

  // --- "next Monday" / day-of-week ---
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayMatch = lower.match(/(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (dayMatch) {
    const targetDay = dayNames.indexOf(dayMatch[1]);
    if (targetDay !== -1) {
      let daysAhead = (targetDay - now.getDay() + 7) % 7;
      if (daysAhead === 0) daysAhead = 7; // "next X" means next occurrence
      date.setDate(date.getDate() + daysAhead);
      date.setHours(9, 0, 0, 0);
      return formatLocalISO(date);
    }
  }

  // --- "March 10" / "March 10th" ---
  const monthNames = ["january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"];
  const monthDayMatch = lower.match(
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?/,
  );
  if (monthDayMatch) {
    const month = monthNames.indexOf(monthDayMatch[1]);
    const day = parseInt(monthDayMatch[2], 10);
    if (month !== -1) {
      date.setMonth(month, day);
      date.setHours(9, 0, 0, 0);
      // If the date already passed this year, assume next year
      if (date.getTime() < now.getTime()) {
        date.setFullYear(date.getFullYear() + 1);
      }
      return formatLocalISO(date);
    }
  }

  // --- "at 5:30 pm", "at 9pm", "at 17:00", "by 3pm" ---
  const timeMatch = lower.match(
    /(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2] || "0", 10);
  const ampm = timeMatch[3]?.toLowerCase();

  if (ampm === "pm" && hours < 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  if (lower.includes("tomorrow")) {
    date.setDate(date.getDate() + 1);
  }

  date.setHours(hours, minutes, 0, 0);

  // Auto-bump to tomorrow if parsed time already passed today (and no explicit "today")
  if (date.getTime() <= now.getTime() && !lower.includes("today") && !lower.includes("tomorrow")) {
    date.setDate(date.getDate() + 1);
  }

  return formatLocalISO(date);
}

export function createTools(userId: number) {
  const remember = tool(
    async ({ content, category }) => {
      try {
        // Goals/tasks should use add_task tool (which has dueDate fallback)
        if (category.toLowerCase() === "goal" || category.toLowerCase() === "task") {
          // Store as a memory note instead of creating a task directly
          await appendMemory("user", userId, "goals", `- ${content}`, {
            category: "goal",
            tags: ["goal"],
            source: "conversation",
          });
          return JSON.stringify({
            status: "stored",
            content,
            category: "goal",
            hint: "If this has a deadline, use add_task tool to create a trackable task with a dueDate.",
          });
        }

        const section = categoryToSection(category);

        // For user-level categories, group into a single file per category
        // For relationships/knowledge, create per-topic files
        let filename: string;
        if (section === "user") {
          filename = category === "fact" ? "facts" : `${category}s`;
          const entry = `- ${content}`;
          await appendMemory(section, userId, filename, entry, {
            category,
            tags: [category],
            source: "conversation",
          });
        } else {
          filename = contentToFilename(content, category);
          await appendMemory(section, userId, filename, `- ${content}`, {
            category,
            tags: [category],
            source: "conversation",
          });
        }

        return JSON.stringify({
          status: "stored",
          content,
          category,
          file: `${section}/${userId}/${filename}.md`,
        });
      } catch (err) {
        console.error("[tool:remember] Failed to store memory:", err);
        return JSON.stringify({
          status: "error",
          message: `Failed to store memory: ${(err as Error).message}`,
        });
      }
    },
    {
      name: "remember",
      description:
        "Store a piece of information about the user for long-term memory. Use this when the user shares facts, preferences, or important details about themselves. For goals/tasks, use add_task instead. Information is saved to markdown files organized by category.",
      schema: z.object({
        content: z.string().describe("The information to remember"),
        category: z
          .string()
          .min(1)
          .describe(
            "Memory category. Built-ins: fact, preference, relationship, note. For goals/tasks use add_task tool instead. Any custom category is allowed and becomes its own memory section.",
          ),
      }),
    },
  );

  const recall = tool(
    async ({ query }) => {
      const results = await searchMemories(userId, query);

      if (results.length === 0) {
        return JSON.stringify({
          results: [],
          message: "No matching memories found",
        });
      }

      return JSON.stringify({
        results: results.map((m) => ({
          file: m.path,
          content: m.snippet,
          category: m.meta.category,
          tags: m.meta.tags,
          updated: m.meta.updated,
        })),
      });
    },
    {
      name: "recall",
      description:
        "Search long-term memory for information about the user. Searches across all memory files (user profile, knowledge, relationships, journal) for matching content.",
      schema: z.object({
        query: z.string().describe("Search query to find relevant memories"),
      }),
    },
  );

  const readMemoryFile = tool(
    async ({ file }) => {
      try {
        const { section, filename } = parseMemoryPath(file);

        const result = await readMemory(section, userId, filename);
        return JSON.stringify({
          path: result.path,
          content: result.content,
          meta: result.meta,
        });
      } catch {
        return JSON.stringify({ error: `Memory file not found: ${file}` });
      }
    },
    {
      name: "read_memory",
      description:
        'Read the full contents of a specific memory file. Use paths like "user/preferences", "knowledge/topic", "relationships/person-name", "journal/2026-02-13".',
      schema: z.object({
        file: z
          .string()
          .describe(
            'Path to the memory file, e.g. "user/preferences" or "knowledge/coding"',
          ),
      }),
    },
  );

  const writeMemoryFile = tool(
    async ({ file, content, tags }) => {
      const { section, filename } = parseMemoryPath(file);

      const result = await writeMemory(section, userId, filename, content, {
        category: section,
        tags: tags || [],
        source: "conversation",
      });

      return JSON.stringify({
        status: "written",
        path: result.path,
      });
    },
    {
      name: "write_memory",
      description:
        'Write or overwrite a memory file with new content. Use this for structured knowledge that replaces the previous version. Path format: "section/filename" (e.g., "user/preferences", "knowledge/coding-style").',
      schema: z.object({
        file: z
          .string()
          .describe(
            'Path to the memory file, e.g. "user/preferences" or "knowledge/project-notes"',
          ),
        content: z.string().describe("The markdown content to write"),
        tags: z
          .array(z.string())
          .optional()
          .describe("Optional tags for the memory"),
      }),
    },
  );

  const appendMemoryFile = tool(
    async ({ file, content, tags }) => {
      const { section, filename } = parseMemoryPath(file);

      const result = await appendMemory(section, userId, filename, content, {
        category: section,
        tags: tags || [],
        source: "conversation",
      });

      return JSON.stringify({
        status: "appended",
        path: result.path,
      });
    },
    {
      name: "append_memory",
      description:
        'Append content to a memory file and create it if missing. Best for incremental notes, logs, and running lists. Path format: "section/filename".',
      schema: z.object({
        file: z
          .string()
          .describe(
            'Path to the memory file, e.g. "journal/2026-03-06" or "knowledge/project-notes"',
          ),
        content: z
          .string()
          .describe("Markdown text to append (can include checklist bullets)"),
        tags: z
          .array(z.string())
          .optional()
          .describe("Optional tags for newly created files"),
      }),
    },
  );

  const getProfile = tool(
    async () => {
      const [user] = await db
        .select({
          name: schema.users.name,
          gender: schema.users.gender,
          age: schema.users.age,
          birthday: schema.users.birthday,
          username: schema.users.username,
        })
        .from(schema.users)
        .where(eq(schema.users.id, userId));

      if (!user) return JSON.stringify({ error: "User not found" });
      return JSON.stringify(user);
    },
    {
      name: "get_profile",
      description:
        "Get the user's profile information including name, age, gender, birthday.",
      schema: z.object({}),
    },
  );

  const browseMemories = tool(
    async ({ section }) => {
      const results = section
        ? await listMemoryFiles(section as MemorySection, userId)
        : await listAllMemories(userId);

      return JSON.stringify({
        count: results.length,
        memories: results.map((m) => ({
          path: m.path,
          category: m.meta.category,
          tags: m.meta.tags,
          updated: m.meta.updated,
          snippet: m.snippet,
        })),
      });
    },
    {
      name: "list_memories",
      description:
        "List all stored memory files, optionally filtered by section (user, knowledge, relationships, journal).",
      schema: z.object({
        section: z
          .string()
          .optional()
          .describe("Optional section filter"),
      }),
    },
  );

  const journal = tool(
    async ({ entry }) => {
      const result = await writeJournalEntry(userId, entry);
      return JSON.stringify({
        status: "journaled",
        path: result.path,
      });
    },
    {
      name: "journal",
      description:
        "Write a journal entry for today. Use this to log important events, session summaries, or daily notes. Content is appended to today's journal file.",
      schema: z.object({
        entry: z.string().describe("The journal entry content to append"),
      }),
    },
  );

  const listTasks = tool(
    async () => {
      const rows = await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.userId, userId))
        .orderBy(schema.tasks.done, schema.tasks.createdAt);

      const open = rows.filter((t) => !t.done).length;
      const completed = rows.filter((t) => t.done).length;

      return JSON.stringify({
        count: rows.length,
        open,
        completed,
        tasks: rows.map((t) => ({
          id: t.id,
          text: t.text,
          done: t.done,
          priority: t.priority,
          dueDate: t.dueDate,
        })),
      });
    },
    {
      name: "list_tasks",
      description:
        "List all user tasks. Returns task ids, text, completion status, priority, and due dates.",
      schema: z.object({}),
    },
  );

  const addTask = tool(
    async ({ task, priority, dueDate }) => {
      const text = task.trim();
      if (!text) {
        return JSON.stringify({ status: "error", error: "Task text is required" });
      }

      // Fallback: if no dueDate provided, try to extract time from task text
      let resolvedDueDate = dueDate ?? null;
      if (!resolvedDueDate) {
        resolvedDueDate = extractDueDateFromText(text);
      }

      const [created] = await db
        .insert(schema.tasks)
        .values({
          userId,
          text,
          priority: priority ?? 0,
          dueDate: resolvedDueDate,
        })
        .returning();
      await syncReminderJobsForTask(created);

      return JSON.stringify({
        status: "added",
        task: {
          id: created.id,
          text: created.text,
          done: false,
          priority: created.priority,
          dueDate: created.dueDate,
        },
      });
    },
    {
      name: "add_task",
      description:
        "Add a new task for the user. MUST set dueDate whenever user mentions ANY time, deadline, or schedule (e.g. 'at 5pm', 'tomorrow', 'next week', 'in 2 hours'). Call get_current_time first to know the current date/time, then calculate the ISO datetime (YYYY-MM-DDTHH:mm:ss).",
      schema: z.object({
        task: z.string().min(1).describe("Task text to add"),
        priority: z.number().int().min(0).max(2).optional().describe("Priority: 0=normal, 1=high, 2=urgent"),
        dueDate: z.string().optional().describe("Due date/time in ISO format (YYYY-MM-DDTHH:mm:ss). REQUIRED when user mentions any time or deadline."),
      }),
    },
  );

  const completeTask = tool(
    async ({ id, task }) => {
      let targetId: number | undefined;

      if (typeof id === "number") {
        targetId = id;
      } else if (typeof task === "string" && task.trim()) {
        // Find by text match
        const rows = await db
          .select()
          .from(schema.tasks)
          .where(eq(schema.tasks.userId, userId));
        const needle = task.trim().toLowerCase();
        const match =
          rows.find((t) => t.text.toLowerCase() === needle) ||
          rows.find((t) => t.text.toLowerCase().includes(needle));
        targetId = match?.id;
      }

      if (!targetId) {
        return JSON.stringify({ status: "error", error: "Task not found" });
      }

      const [updated] = await db
        .update(schema.tasks)
        .set({
          done: true,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.tasks.id, targetId))
        .returning();

      if (!updated) {
        return JSON.stringify({ status: "error", error: "Task not found" });
      }
      await syncReminderJobsForTask(updated);

      return JSON.stringify({
        status: "completed",
        task: { id: updated.id, text: updated.text },
      });
    },
    {
      name: "complete_task",
      description:
        "Mark a task as completed. Provide either the task id or task text to match.",
      schema: z
        .object({
          id: z.number().int().positive().optional(),
          task: z.string().optional(),
        })
        .refine((v) => v.id !== undefined || (v.task?.trim().length ?? 0) > 0, {
          message: "Provide id or task",
        }),
    },
  );

  const getCurrentFocus = tool(
    async () => {
      const existing = await readMemory("user", userId, "current-focus").catch(
        () => null,
      );

      if (!existing) {
        return JSON.stringify({
          status: "empty",
          focus: null,
          message: "No current focus set",
        });
      }

      const focus = parseCurrentFocus(existing.content);

      return JSON.stringify({
        status: "ok",
        focus: focus || null,
        path: existing.path,
        updated: existing.meta.updated,
      });
    },
    {
      name: "get_current_focus",
      description:
        "Get the user's current focus item from user/current-focus memory file.",
      schema: z.object({}),
    },
  );

  const setCurrentFocus = tool(
    async ({ focus, note }) => {
      const focusText = focus.trim();
      if (!focusText) {
        return JSON.stringify({
          status: "error",
          error: "Focus text is required",
        });
      }

      const content = renderCurrentFocus(focusText, note);
      const result = await writeMemory("user", userId, "current-focus", content, {
        category: "goal",
        tags: ["focus", "task"],
        source: "conversation",
      });

      return JSON.stringify({
        status: "set",
        focus: focusText,
        path: result.path,
      });
    },
    {
      name: "set_current_focus",
      description:
        "Set or replace the user's current focus item in user/current-focus memory.",
      schema: z.object({
        focus: z.string().min(1).describe("Current focus text"),
        note: z.string().optional().describe("Optional note for the focus"),
      }),
    },
  );

  const clearCurrentFocus = tool(
    async () => {
      const deleted = await deleteMemory("user", userId, "current-focus");

      return JSON.stringify({
        status: deleted ? "cleared" : "not_found",
      });
    },
    {
      name: "clear_current_focus",
      description: "Clear current focus by deleting user/current-focus memory file.",
      schema: z.object({}),
    },
  );

  const getWeather = tool(
    async ({ location }) => {
      try {
        // Open-Meteo — free, no API key needed
        // First geocode the location
        const geoRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`,
        );
        const geoData = (await geoRes.json()) as {
          results?: Array<{
            latitude: number;
            longitude: number;
            name: string;
            country: string;
          }>;
        };

        if (!geoData.results?.length) {
          return JSON.stringify({ error: `Location not found: ${location}` });
        }

        const { latitude, longitude, name, country } = geoData.results[0];

        // Fetch current weather
        const weatherRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=celsius`,
        );
        const weatherData = (await weatherRes.json()) as {
          current: {
            temperature_2m: number;
            relative_humidity_2m: number;
            apparent_temperature: number;
            weather_code: number;
            wind_speed_10m: number;
          };
        };

        const c = weatherData.current;
        return JSON.stringify({
          location: `${name}, ${country}`,
          temperature: `${c.temperature_2m}°C`,
          feels_like: `${c.apparent_temperature}°C`,
          humidity: `${c.relative_humidity_2m}%`,
          wind: `${c.wind_speed_10m} km/h`,
          condition: weatherCodeToText(c.weather_code),
        });
      } catch (err) {
        return JSON.stringify({
          error: `Weather fetch failed: ${(err as Error).message}`,
        });
      }
    },
    {
      name: "get_weather",
      description:
        "Get current weather data for a location. Returns temperature, humidity, wind speed, and conditions.",
      schema: z.object({
        location: z
          .string()
          .describe("City name or location to get weather for"),
      }),
    },
  );

  const getCurrentTime = tool(
    async ({ timeZone, locale }) => {
      const now = new Date();
      const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

      try {
        const formatted = new Intl.DateTimeFormat(locale || "en-US", {
          timeZone: zone,
          dateStyle: "full",
          timeStyle: "long",
          hour12: false,
        }).format(now);

        return JSON.stringify({
          status: "ok",
          iso: now.toISOString(),
          unix: Math.floor(now.getTime() / 1000),
          timeZone: zone,
          localTime: formatted,
        });
      } catch {
        return JSON.stringify({
          status: "error",
          error: `Invalid timezone: ${timeZone}`,
        });
      }
    },
    {
      name: "get_current_time",
      description:
        "Get the current date and time for a user timezone. Provide an IANA timezone like 'America/New_York'.",
      schema: z.object({
        timeZone: z
          .string()
          .optional()
          .describe("Optional IANA timezone, e.g. America/New_York"),
        locale: z
          .string()
          .optional()
          .describe("Optional locale, e.g. en-US"),
      }),
    },
  );

  return [
    remember,
    recall,
    readMemoryFile,
    writeMemoryFile,
    appendMemoryFile,
    getProfile,
    browseMemories,
    journal,
    listTasks,
    addTask,
    completeTask,
    getCurrentFocus,
    setCurrentFocus,
    clearCurrentFocus,
    getWeather,
    getCurrentTime,
  ];
}

// WMO weather codes → readable text
function weatherCodeToText(code: number): string {
  const map: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    80: "Slight showers",
    81: "Moderate showers",
    82: "Violent showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Thunderstorm with heavy hail",
  };
  return map[code] || `Code ${code}`;
}
