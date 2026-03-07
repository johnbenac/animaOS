import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, type DailyBrief, type Nudge, type HomeData, type TaskItem } from "../lib/api";

function getTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 21) return "evening";
  return "night";
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [dismissedNudges, setDismissedNudges] = useState<Set<string>>(new Set());
  const [home, setHome] = useState<HomeData | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [newTask, setNewTask] = useState("");
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;

    setBriefLoading(true);
    api.chat
      .brief(user.id)
      .then((b) => { if (active) setBrief(b); })
      .catch(() => {})
      .finally(() => { if (active) setBriefLoading(false); });

    api.chat
      .nudges(user.id)
      .then((res) => { if (active) setNudges(res.nudges); })
      .catch(() => {});

    api.chat
      .home(user.id)
      .then((data) => { if (active) setHome(data); })
      .catch(() => {});

    api.tasks
      .list(user.id)
      .then((rows) => { if (active) setTasks(rows); })
      .catch(() => {});

    return () => { active = false; };
  }, [user?.id]);

  const toggleTask = async (task: TaskItem) => {
    const updated = await api.tasks.update(task.id, { done: !task.done });
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.trim() || !user?.id) return;
    const created = await api.tasks.create(user.id, newTask.trim());
    setTasks((prev) => [...prev, created]);
    setNewTask("");
  };

  const deleteTask = async (id: number) => {
    await api.tasks.delete(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const activeNudges = nudges.filter((n) => !dismissedNudges.has(n.type));
  const openTasks = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done);
  const tod = getTimeOfDay();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    navigate(`/chat?msg=${encodeURIComponent(input.trim())}`);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto px-6 py-12 space-y-10">
        {/* Greeting */}
        <div className="relative text-center space-y-4 pt-4 pb-2">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-(--color-primary)/[0.03] rounded-full blur-3xl pointer-events-none" />
          <div className="relative space-y-3">
            <p className="text-xs text-(--color-text-muted)/40 uppercase tracking-[0.3em]">
              Good {tod}{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
            </p>
            {briefLoading && (
              <div className="flex justify-center gap-1 py-2">
                <span className="w-1 h-1 rounded-full bg-(--color-text-muted)/30 animate-pulse" />
                <span className="w-1 h-1 rounded-full bg-(--color-text-muted)/30 animate-pulse [animation-delay:150ms]" />
                <span className="w-1 h-1 rounded-full bg-(--color-text-muted)/30 animate-pulse [animation-delay:300ms]" />
              </div>
            )}
            {brief && !briefLoading && (
              <p className="text-[15px] text-(--color-text)/90 leading-relaxed max-w-md mx-auto">
                {brief.message}
              </p>
            )}
            {!brief && !briefLoading && (
              <p className="text-[15px] text-(--color-text-muted)/60">
                What's on your mind?
              </p>
            )}
          </div>
        </div>

        {/* Chat input */}
        <form onSubmit={handleSubmit} className="relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Talk to ANIMA..."
            className="w-full bg-(--color-bg-card) border border-(--color-border) rounded-xl px-5 py-3.5 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/25 outline-none focus:border-(--color-text-muted)/30 transition-all"
          />
          {input.trim() && (
            <button
              type="submit"
              className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-(--color-primary) hover:text-(--color-text) transition-colors"
            >
              &rarr;
            </button>
          )}
        </form>

        {/* Nudges */}
        {activeNudges.length > 0 && (
          <div className="space-y-2">
            {activeNudges.map((nudge) => (
              <div
                key={nudge.type}
                className="flex items-center justify-between gap-3 px-4 py-2.5 bg-(--color-bg-card)/50 border border-(--color-border) rounded-lg"
              >
                <span className="text-xs text-(--color-text-muted)">{nudge.message}</span>
                <button
                  onClick={() => setDismissedNudges((prev) => new Set([...prev, nudge.type]))}
                  className="text-[10px] text-(--color-text-muted)/40 hover:text-(--color-text-muted) shrink-0"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Focus + Tasks */}
        {(home?.currentFocus || openTasks.length > 0 || doneTasks.length > 0 || true) && (
          <div className="bg-(--color-bg-card) border border-(--color-border) rounded-xl p-5 space-y-4">
            {home?.currentFocus && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-(--color-text-muted)/50 mb-1.5">
                  Focusing on
                </p>
                <p className="text-sm text-(--color-text)">
                  {home.currentFocus}
                </p>
              </div>
            )}

            <div>
              {home?.currentFocus && <div className="border-t border-(--color-border) -mx-5 mb-4" />}

              {/* Quick add */}
              <form onSubmit={handleAddTask} className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={newTask}
                  onChange={(e) => setNewTask(e.target.value)}
                  placeholder="Add a task..."
                  className="flex-1 bg-transparent border border-(--color-border) rounded-lg px-3 py-1.5 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/25 outline-none focus:border-(--color-text-muted)/30 transition-colors"
                />
                {newTask.trim() && (
                  <button
                    type="submit"
                    className="text-xs text-(--color-primary) hover:text-(--color-text) px-2 transition-colors"
                  >
                    +
                  </button>
                )}
              </form>

              <div className="space-y-1.5">
                {openTasks.map((task) => (
                  <div key={task.id} className="flex items-start gap-2.5 group">
                    <button
                      onClick={() => toggleTask(task)}
                      className="w-4 h-4 rounded-full border border-(--color-border) shrink-0 mt-0.5 hover:border-(--color-primary)/60 hover:bg-(--color-primary)/10 transition-colors cursor-pointer"
                    />
                    <span className="text-sm text-(--color-text)/80 flex-1">{task.text}</span>
                    <button
                      onClick={() => deleteTask(task.id)}
                      className="text-[10px] text-(--color-text-muted)/0 group-hover:text-(--color-text-muted)/40 hover:!text-(--color-text-muted) transition-colors"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {doneTasks.slice(0, 3).map((task) => (
                  <div key={task.id} className="flex items-start gap-2.5 opacity-40 group">
                    <button
                      onClick={() => toggleTask(task)}
                      className="w-4 h-4 rounded-full bg-(--color-success)/20 border border-(--color-success)/30 shrink-0 mt-0.5 flex items-center justify-center cursor-pointer hover:bg-(--color-success)/30 transition-colors"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-(--color-success)/60" />
                    </button>
                    <span className="text-sm line-through flex-1">{task.text}</span>
                    <button
                      onClick={() => deleteTask(task.id)}
                      className="text-[10px] text-(--color-text-muted)/0 group-hover:text-(--color-text-muted)/40 hover:!text-(--color-text-muted) transition-colors"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {doneTasks.length > 3 && (
                  <p className="text-[10px] text-(--color-text-muted)/30 pl-6.5">
                    +{doneTasks.length - 3} completed
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
