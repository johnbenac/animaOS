import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  api,
  type AgentConfig,
  type ChatMessage,
  type EmailMessage,
  type EmailProvider,
} from "../lib/api";

type MemorySection = "user" | "knowledge" | "relationships" | "journal";

interface MemoryMeta {
  category?: string;
  tags?: string[];
  created?: string;
  updated?: string;
  source?: string;
}

interface MemoryEntry {
  path: string;
  meta: MemoryMeta;
  snippet: string;
}

interface MemoryFile {
  path: string;
  meta: MemoryMeta;
  content: string;
}

interface MemoryListResponse {
  count: number;
  memories: MemoryEntry[];
}

interface GoalTask {
  label: string;
  done: boolean;
}

const API_BASE = "http://localhost:3031/api";

function formatToday(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
}

function toRelativeTime(value?: string): string {
  if (!value) return "n/a";
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return "n/a";

  const diffMs = Date.now() - ms;
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function trimLine(line: string, max = 78): string {
  return line.length <= max ? line : `${line.slice(0, max - 3)}...`;
}

function extractChecklist(markdown: string): GoalTask[] {
  const seen = new Set<string>();
  const results: GoalTask[] = [];

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === "---" || line.startsWith("#")) continue;

    const checklist = line.match(/^- \[( |x|X)\]\s+(.+)$/);
    if (checklist) {
      const label = checklist[2].trim();
      const key = label.toLowerCase();
      if (!label || seen.has(key)) continue;

      seen.add(key);
      results.push({ label, done: checklist[1].toLowerCase() === "x" });
      continue;
    }

    const bullet = line.match(/^- (.+)$/);
    if (bullet) {
      const label = bullet[1].trim();
      const key = label.toLowerCase();
      if (!label || seen.has(key)) continue;

      seen.add(key);
      results.push({ label, done: false });
    }
  }

  return results;
}

function extractBullets(markdown: string): string[] {
  const bullets: string[] = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === "---" || line.startsWith("#")) continue;

    const checklist = line.match(/^- \[(?: |x|X)\]\s+(.+)$/);
    if (checklist) {
      bullets.push(checklist[1].trim());
      continue;
    }

    const bullet = line.match(/^- (.+)$/);
    if (bullet) {
      bullets.push(bullet[1].trim());
    }
  }
  return bullets;
}

async function fetchMemoryList(userId: number): Promise<MemoryListResponse> {
  const res = await fetch(`${API_BASE}/memory/${userId}`);
  if (!res.ok) throw new Error("Failed to load memory list");
  return res.json();
}

async function fetchMemoryFile(
  userId: number,
  section: MemorySection,
  filename: string,
): Promise<MemoryFile | null> {
  const res = await fetch(`${API_BASE}/memory/${userId}/${section}/${filename}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load ${section}/${filename}`);
  return res.json();
}

function parseCurrentFocusFromContent(content: string): string {
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

function renderCurrentFocusContent(focus: string): string {
  return `# Current Focus\n\n- [ ] ${focus.trim()}`;
}

async function saveCurrentFocusFile(
  userId: number,
  focus: string,
): Promise<MemoryFile> {
  const res = await fetch(`${API_BASE}/memory/${userId}/user/current-focus`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: renderCurrentFocusContent(focus),
      tags: ["focus", "task"],
    }),
  });

  if (!res.ok) {
    throw new Error("Failed to save current focus");
  }

  return (await res.json()) as MemoryFile;
}

async function clearCurrentFocusFile(userId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/memory/${userId}/user/current-focus`, {
    method: "DELETE",
  });

  if (!res.ok) {
    throw new Error("Failed to clear current focus");
  }
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [recentMessages, setRecentMessages] = useState<ChatMessage[]>([]);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [goalsFile, setGoalsFile] = useState<MemoryFile | null>(null);
  const [factsFile, setFactsFile] = useState<MemoryFile | null>(null);
  const [currentFocusFile, setCurrentFocusFile] = useState<MemoryFile | null>(
    null,
  );
  const [currentTask, setCurrentTask] = useState("");
  const [taskInput, setTaskInput] = useState("");
  const [focusSaving, setFocusSaving] = useState(false);
  const [focusError, setFocusError] = useState("");
  const [emailProvider, setEmailProvider] = useState<EmailProvider>("gmail");
  const [emailToken, setEmailToken] = useState("");
  const [emailQuery, setEmailQuery] = useState("");
  const [emailUnreadOnly, setEmailUnreadOnly] = useState(true);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emails, setEmails] = useState<EmailMessage[]>([]);

  const today = formatToday(new Date());

  useEffect(() => {
    if (!user?.id) return;

    let active = true;
    setLoading(true);
    setError("");

    Promise.all([
      fetchMemoryList(user.id),
      fetchMemoryFile(user.id, "user", "goals"),
      fetchMemoryFile(user.id, "user", "facts"),
      fetchMemoryFile(user.id, "user", "current-focus"),
      api.chat.history(user.id, 10),
      api.config.get(user.id),
    ])
      .then(
        ([
          memoryData,
          goals,
          facts,
          focusFile,
          history,
          runtimeConfig,
        ]) => {
        if (!active) return;

        setMemories(memoryData.memories || []);
        setGoalsFile(goals);
        setFactsFile(facts);
        setCurrentFocusFile(focusFile);
        setRecentMessages(history.slice(-6).reverse());
        setConfig(runtimeConfig);

        const focus = focusFile?.content
          ? parseCurrentFocusFromContent(focusFile.content)
          : "";
        if (focus) {
          setCurrentTask(focus);
        } else {
          const firstOpenTask =
            goals?.content
              ? extractChecklist(goals.content).find((task) => !task.done)?.label
              : undefined;
          setCurrentTask(firstOpenTask || "");
        }
      },
      )
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  const tasks = useMemo(
    () => (goalsFile?.content ? extractChecklist(goalsFile.content) : []),
    [goalsFile?.content],
  );
  const openTasks = useMemo(
    () => tasks.filter((task) => !task.done).map((task) => task.label),
    [tasks],
  );
  const completedCount = tasks.filter((task) => task.done).length;
  const facts = useMemo(
    () => (factsFile?.content ? extractBullets(factsFile.content).slice(0, 4) : []),
    [factsFile?.content],
  );

  const memoryBySection = useMemo(() => {
    return memories.reduce(
      (acc, entry) => {
        const section = entry.path.split("/")[0] as MemorySection;
        acc[section] = (acc[section] || 0) + 1;
        return acc;
      },
      {
        user: 0,
        knowledge: 0,
        relationships: 0,
        journal: 0,
      } as Record<MemorySection, number>,
    );
  }, [memories]);

  const latestMemoryUpdate = useMemo(() => {
    let latest: string | undefined;
    for (const entry of memories) {
      const updated = entry.meta.updated;
      if (!updated) continue;
      if (!latest || new Date(updated).getTime() > new Date(latest).getTime()) {
        latest = updated;
      }
    }
    return latest;
  }, [memories]);

  const setFocusTask = async (task: string) => {
    const value = task.trim();
    if (!value || !user?.id) return;

    setCurrentTask(value);
    setFocusSaving(true);
    setFocusError("");

    try {
      const saved = await saveCurrentFocusFile(user.id, value);
      setCurrentFocusFile(saved);
    } catch (err) {
      setFocusError(err instanceof Error ? err.message : "Failed to save focus");
    } finally {
      setFocusSaving(false);
    }
  };

  const clearFocusTask = async () => {
    if (!user?.id) return;

    setFocusSaving(true);
    setFocusError("");

    try {
      await clearCurrentFocusFile(user.id);
      setCurrentTask("");
      setCurrentFocusFile(null);
    } catch (err) {
      setFocusError(err instanceof Error ? err.message : "Failed to clear focus");
    } finally {
      setFocusSaving(false);
    }
  };

  const saveCustomTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskInput.trim()) return;
    await setFocusTask(taskInput);
    setTaskInput("");
  };

  const handleFetchEmails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailToken.trim()) {
      setEmailError("Access token is required.");
      return;
    }

    setEmailLoading(true);
    setEmailError("");

    try {
      const result = await api.email.fetch(emailProvider, emailToken.trim(), {
        maxResults: 10,
        unreadOnly: emailUnreadOnly,
        query: emailQuery.trim() || undefined,
      });
      setEmails(result.emails);
    } catch (err) {
      setEmailError(
        err instanceof Error ? err.message : "Failed to fetch inbox.",
      );
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg">
      <nav className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-card">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-text-muted">{">"}</span>
          <span className="font-mono font-bold text-xs tracking-[0.2em] uppercase">
            ANIMA
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/chat"
            className="font-mono text-[11px] text-text-muted transition-colors hover:text-text uppercase tracking-wider"
          >
            Chat
          </Link>
          <Link
            to="/memory"
            className="font-mono text-[11px] text-text-muted transition-colors hover:text-text uppercase tracking-wider"
          >
            Memory
          </Link>
          <Link
            to="/settings"
            className="font-mono text-[11px] text-text-muted transition-colors hover:text-text uppercase tracking-wider"
          >
            Config
          </Link>
          <Link
            to="/profile"
            className="font-mono text-[11px] text-text-muted transition-colors hover:text-text uppercase tracking-wider"
          >
            Profile
          </Link>
          <button
            onClick={logout}
            className="bg-transparent text-text-muted border border-border px-3 py-1.5 rounded-sm font-mono text-[11px] uppercase tracking-wider cursor-pointer transition-colors hover:text-text hover:border-text-muted"
          >
            Exit
          </button>
        </div>
      </nav>

      <main className="max-w-[1180px] mx-auto px-6 py-8 space-y-4">
        <section className="grid gap-4 lg:grid-cols-[1.6fr,1fr]">
          <div className="bg-bg-card border border-border rounded-sm p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] text-text-muted uppercase tracking-wider">
                  {today}
                </p>
                <h1 className="font-mono text-2xl font-semibold mt-2">
                  Welcome back, {user?.name}
                </h1>
                <p className="text-xs text-text-muted mt-3">
                  Dashboard synced with your memory, chat, and runtime config.
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                  Memory files
                </p>
                <p className="font-mono text-2xl mt-1">{memories.length}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 mt-6">
              <StatChip label="User" value={memoryBySection.user} />
              <StatChip label="Knowledge" value={memoryBySection.knowledge} />
              <StatChip label="Relations" value={memoryBySection.relationships} />
              <StatChip label="Journal" value={memoryBySection.journal} />
            </div>

            <div className="flex flex-wrap gap-2 mt-6">
              <Link
                to="/chat"
                className="text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-sm border border-text-muted text-text hover:border-text transition-colors"
              >
                Continue chat
              </Link>
              <Link
                to="/memory"
                className="text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-sm border border-border text-text-muted hover:text-text hover:border-text-muted transition-colors"
              >
                Open memory
              </Link>
              <Link
                to="/settings"
                className="text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-sm border border-border text-text-muted hover:text-text hover:border-text-muted transition-colors"
              >
                Runtime config
              </Link>
            </div>
          </div>

          <div className="bg-bg-card border border-border rounded-sm p-6">
            <p className="font-mono text-[11px] text-text-muted uppercase tracking-wider">
              Current Focus
            </p>
            <p className="text-sm mt-3 leading-relaxed min-h-[3rem]">
              {currentTask || "No focus task set yet. Pick one below or type your own."}
            </p>
            <p className="text-[10px] mt-1 text-text-muted">
              {focusSaving
                ? "Saving focus..."
                : currentFocusFile?.meta.updated
                  ? `Synced ${toRelativeTime(currentFocusFile.meta.updated)}`
                  : "Not synced to memory"}
            </p>

            {openTasks.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {openTasks.slice(0, 6).map((task) => (
                  <button
                    key={task}
                    onClick={() => void setFocusTask(task)}
                    disabled={focusSaving}
                    className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
                      currentTask === task
                        ? "border-text text-text"
                        : "border-border text-text-muted hover:border-text-muted hover:text-text"
                    } disabled:opacity-50`}
                  >
                    {trimLine(task, 40)}
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={saveCustomTask} className="mt-4 flex gap-2">
              <input
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                placeholder="Set manual focus..."
                className="flex-1 bg-bg-input border border-border rounded-sm px-2 py-1.5 text-xs text-text placeholder:text-text-muted/50 outline-none focus:border-text-muted"
              />
              <button
                type="submit"
                disabled={focusSaving}
                className="text-[11px] uppercase tracking-wider px-2 py-1.5 rounded-sm border border-text-muted text-text hover:border-text transition-colors disabled:opacity-50"
              >
                {focusSaving ? "Saving..." : "Set"}
              </button>
            </form>

            {currentTask && (
              <button
                onClick={() => void clearFocusTask()}
                disabled={focusSaving}
                className="mt-2 text-[10px] uppercase tracking-wider text-text-muted hover:text-text transition-colors disabled:opacity-50"
              >
                Clear focus
              </button>
            )}
            {focusError && (
              <p className="mt-2 text-xs text-danger border border-danger/30 rounded-sm px-2 py-1.5">
                {focusError}
              </p>
            )}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="bg-bg-card border border-border rounded-sm p-5">
            <h2 className="font-mono text-xs uppercase tracking-wider text-text-muted">
              Today Queue
            </h2>
            <p className="text-[11px] text-text-muted mt-1">
              Open: {openTasks.length} | Done: {completedCount}
            </p>
            <div className="mt-4 space-y-2">
              {openTasks.length === 0 && (
                <p className="text-xs text-text-muted">
                  No open tasks in `user/goals.md`. Add bullet or checklist items and they
                  will show here.
                </p>
              )}
              {openTasks.slice(0, 5).map((task) => (
                <button
                  key={task}
                  onClick={() => void setFocusTask(task)}
                  disabled={focusSaving}
                  className="w-full text-left text-xs px-2 py-1.5 rounded-sm border border-border hover:border-text-muted transition-colors disabled:opacity-50"
                >
                  {trimLine(task)}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-bg-card border border-border rounded-sm p-5">
            <h2 className="font-mono text-xs uppercase tracking-wider text-text-muted">
              Runtime
            </h2>
            <div className="mt-4 space-y-2 text-xs">
              <InfoRow label="Provider" value={config?.provider || "n/a"} />
              <InfoRow label="Model" value={config?.model || "n/a"} />
              <InfoRow
                label="API key"
                value={
                  config?.provider === "ollama"
                    ? "not needed"
                    : config?.hasApiKey
                      ? "saved"
                      : "missing"
                }
              />
              <InfoRow
                label="Prompt"
                value={config?.systemPrompt ? "custom" : "default"}
              />
            </div>
          </div>

          <div className="bg-bg-card border border-border rounded-sm p-5">
            <h2 className="font-mono text-xs uppercase tracking-wider text-text-muted">
              Personal Context
            </h2>
            <div className="mt-4 space-y-2">
              {facts.length === 0 && (
                <p className="text-xs text-text-muted">
                  No fact highlights yet. Store personal facts in memory to surface them
                  here.
                </p>
              )}
              {facts.map((fact) => (
                <div
                  key={fact}
                  className="text-xs border border-border rounded-sm px-2 py-1.5"
                >
                  {trimLine(fact)}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.35fr,1fr]">
          <div className="bg-bg-card border border-border rounded-sm p-5">
            <h2 className="font-mono text-xs uppercase tracking-wider text-text-muted">
              Recent Activity
            </h2>

            {recentMessages.length === 0 && !loading && (
              <p className="text-xs text-text-muted mt-4">No recent chat history.</p>
            )}

            <div className="mt-4 space-y-2">
              {recentMessages.map((message) => (
                <div
                  key={message.id}
                  className="border border-border rounded-sm px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 text-[10px] text-text-muted uppercase tracking-wider">
                    <span>{message.role}</span>
                    <span>|</span>
                    <span>{toRelativeTime(message.createdAt)}</span>
                  </div>
                  <p className="mt-1 leading-relaxed">{trimLine(message.content, 120)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-bg-card border border-border rounded-sm p-5">
            <h2 className="font-mono text-xs uppercase tracking-wider text-text-muted">
              System Status
            </h2>
            <div className="mt-4 space-y-2">
              <StatusRow label="Dashboard" value={loading ? "syncing" : "ready"} />
              <StatusRow
                label="Memory index"
                value={`${memories.length} files`}
                subtle
              />
              <StatusRow
                label="Last memory write"
                value={toRelativeTime(latestMemoryUpdate)}
                subtle
              />
              <StatusRow
                label="Recent messages"
                value={String(recentMessages.length)}
                subtle
              />
            </div>
            {error && (
              <p className="mt-4 text-xs text-danger border border-danger/30 rounded-sm px-2 py-1.5">
                {error}
              </p>
            )}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr,1.4fr]">
          <div className="bg-bg-card border border-border rounded-sm p-5">
            <h2 className="font-mono text-xs uppercase tracking-wider text-text-muted">
              Email Connector
            </h2>
            <p className="text-xs text-text-muted mt-2">
              Paste OAuth token then fetch Gmail or Outlook inbox.
            </p>

            <form onSubmit={handleFetchEmails} className="mt-4 space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEmailProvider("gmail")}
                  className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
                    emailProvider === "gmail"
                      ? "border-text text-text"
                      : "border-border text-text-muted hover:text-text"
                  }`}
                >
                  Gmail
                </button>
                <button
                  type="button"
                  onClick={() => setEmailProvider("outlook")}
                  className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
                    emailProvider === "outlook"
                      ? "border-text text-text"
                      : "border-border text-text-muted hover:text-text"
                  }`}
                >
                  Outlook
                </button>
              </div>

              <input
                type="password"
                value={emailToken}
                onChange={(e) => setEmailToken(e.target.value)}
                placeholder="OAuth access token..."
                className="w-full bg-bg-input border border-border rounded-sm px-2 py-1.5 text-xs text-text placeholder:text-text-muted/50 outline-none focus:border-text-muted"
              />

              <input
                value={emailQuery}
                onChange={(e) => setEmailQuery(e.target.value)}
                placeholder="Optional search (invoice, github, etc)"
                className="w-full bg-bg-input border border-border rounded-sm px-2 py-1.5 text-xs text-text placeholder:text-text-muted/50 outline-none focus:border-text-muted"
              />

              <label className="flex items-center gap-2 text-[11px] text-text-muted">
                <input
                  type="checkbox"
                  checked={emailUnreadOnly}
                  onChange={(e) => setEmailUnreadOnly(e.target.checked)}
                />
                unread only
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={emailLoading}
                  className="text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-sm border border-text-muted text-text hover:border-text transition-colors disabled:opacity-50"
                >
                  {emailLoading ? "Fetching..." : "Fetch inbox"}
                </button>
                <span className="text-[11px] text-text-muted">
                  {emails.length} loaded
                </span>
              </div>
            </form>

            {emailError && (
              <p className="mt-3 text-xs text-danger border border-danger/30 rounded-sm px-2 py-1.5">
                {emailError}
              </p>
            )}
          </div>

          <div className="bg-bg-card border border-border rounded-sm p-5">
            <h2 className="font-mono text-xs uppercase tracking-wider text-text-muted">
              Inbox Preview
            </h2>

            {emails.length === 0 && (
              <p className="text-xs text-text-muted mt-4">
                No emails loaded yet. Fetch with a valid token.
              </p>
            )}

            <div className="mt-4 space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {emails.map((email) => (
                <div
                  key={`${email.provider}-${email.id}`}
                  className="border border-border rounded-sm px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 text-[10px] text-text-muted uppercase tracking-wider">
                    <span>{email.provider}</span>
                    <span>|</span>
                    <span>{email.isRead ? "read" : "unread"}</span>
                    <span>|</span>
                    <span>{new Date(email.receivedAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 font-medium">{trimLine(email.subject, 90)}</p>
                  <p className="mt-1 text-text-muted">from: {email.from}</p>
                  <p className="mt-1">{trimLine(email.preview, 120)}</p>
                  {email.webLink && (
                    <a
                      href={email.webLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block mt-2 text-[10px] uppercase tracking-wider text-text-muted hover:text-text transition-colors"
                    >
                      Open message
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border rounded-sm px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </p>
      <p className="font-mono text-base mt-1">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border border-border rounded-sm px-2.5 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <span className="text-xs">{value}</span>
    </div>
  );
}

function StatusRow({
  label,
  value,
  subtle = false,
}: {
  label: string;
  value: string;
  subtle?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border border-border rounded-sm text-xs">
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          subtle ? "bg-text-muted" : "bg-text"
        }`}
      />
      <span className="font-mono uppercase tracking-wider">{label}</span>
      <span className="ml-auto text-text-muted">{value}</span>
    </div>
  );
}
