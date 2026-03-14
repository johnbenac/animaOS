import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import {
  api,
  type MemoryItemData,
  type MemoryEpisodeData,
  type MemoryOverviewData,
} from "../lib/api";

type Tab = "facts" | "preferences" | "goals" | "relationships" | "episodes";

const TABS: { key: Tab; label: string }[] = [
  { key: "facts", label: "Facts" },
  { key: "preferences", label: "Preferences" },
  { key: "goals", label: "Goals" },
  { key: "relationships", label: "Relationships" },
  { key: "episodes", label: "Episodes" },
];

const IMPORTANCE_LABELS = ["", "Trivial", "Minor", "Notable", "Significant", "Core"];

export default function Memory() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("facts");
  const [overview, setOverview] = useState<MemoryOverviewData | null>(null);
  const [items, setItems] = useState<MemoryItemData[]>([]);
  const [episodes, setEpisodes] = useState<MemoryEpisodeData[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newImportance, setNewImportance] = useState(3);

  useEffect(() => {
    if (!user?.id) return;
    api.memory.overview(user.id).then(setOverview).catch(console.error);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    loadTab();
  }, [user?.id, tab]);

  const loadTab = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      if (tab === "episodes") {
        const data = await api.memory.listEpisodes(user.id);
        setEpisodes(data);
      } else {
        const data = await api.memory.listItems(user.id, tab === "facts" ? "fact" : tab === "preferences" ? "preference" : tab === "goals" ? "goal" : "relationship");
        setItems(data);
      }
    } catch (err) {
      console.error("Failed to load memory:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!user?.id || !newContent.trim()) return;
    const category =
      tab === "facts" ? "fact" :
      tab === "preferences" ? "preference" :
      tab === "goals" ? "goal" : "relationship";
    try {
      await api.memory.createItem(user.id, {
        content: newContent.trim(),
        category,
        importance: newImportance,
      });
      setNewContent("");
      setNewImportance(3);
      setShowCreate(false);
      loadTab();
      api.memory.overview(user.id).then(setOverview).catch(() => {});
    } catch (err: any) {
      console.error("Failed to create:", err);
    }
  };

  const startEdit = (item: MemoryItemData) => {
    setEditingId(item.id);
    setEditContent(item.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  const saveEdit = async (item: MemoryItemData) => {
    if (!user?.id || !editContent.trim()) return;
    try {
      await api.memory.updateItem(user.id, item.id, {
        content: editContent.trim(),
      });
      setEditingId(null);
      loadTab();
    } catch (err) {
      console.error("Failed to update:", err);
    }
  };

  const deleteItem = async (itemId: number) => {
    if (!user?.id || !confirm("Delete this memory?")) return;
    try {
      await api.memory.deleteItem(user.id, itemId);
      loadTab();
      api.memory.overview(user.id).then(setOverview).catch(() => {});
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  const categoryForTab = (t: Tab): string =>
    t === "facts" ? "fact" : t === "preferences" ? "preference" : t === "goals" ? "goal" : "relationship";

  const countForTab = (t: Tab): number => {
    if (!overview) return 0;
    switch (t) {
      case "facts": return overview.factCount;
      case "preferences": return overview.preferenceCount;
      case "goals": return overview.goalCount;
      case "relationships": return overview.relationshipCount;
      case "episodes": return overview.episodeCount;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-3 border-b border-(--color-border)">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-[11px] text-(--color-text-muted) uppercase tracking-wider">
              Memory
            </span>
            {overview && (
              <span className="text-[10px] text-(--color-text-muted)/50">
                {overview.totalItems} items
              </span>
            )}
          </div>
          {overview?.currentFocus && (
            <div className="text-[10px] text-(--color-text-muted)">
              <span className="text-(--color-text-muted)/50 uppercase tracking-wider mr-1.5">Focus:</span>
              {overview.currentFocus}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-5 py-2 border-b border-(--color-border) flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setShowCreate(false); setEditingId(null); }}
            className={`text-[10px] px-2 py-1 rounded uppercase tracking-wider transition-colors ${
              tab === t.key
                ? "bg-(--color-primary) text-(--color-bg)"
                : "text-(--color-text-muted) hover:text-(--color-text) bg-(--color-bg-card)"
            }`}
          >
            {t.label}
            <span className="ml-1 text-(--color-text-muted)/40">
              {countForTab(t.key)}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading && (
          <div className="text-xs text-(--color-text-muted) animate-pulse">Loading...</div>
        )}

        {/* Episodes tab */}
        {!loading && tab === "episodes" && (
          <div className="space-y-3 max-w-2xl">
            {episodes.length === 0 && (
              <div className="text-xs text-(--color-text-muted)">
                No episodes yet. Episodes are generated after 3+ conversation turns.
              </div>
            )}
            {episodes.map((ep) => (
              <div
                key={ep.id}
                className="bg-(--color-bg-card) border border-(--color-border) rounded-md px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-(--color-text) leading-relaxed">
                      {ep.summary}
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] text-(--color-text-muted)/60">
                        {ep.date}{ep.time ? ` ${ep.time}` : ""}
                      </span>
                      {ep.emotionalArc && (
                        <>
                          <span className="text-(--color-border)">·</span>
                          <span className="text-[10px] text-(--color-text-muted)/60 italic">
                            {ep.emotionalArc}
                          </span>
                        </>
                      )}
                      {ep.turnCount != null && (
                        <>
                          <span className="text-(--color-border)">·</span>
                          <span className="text-[10px] text-(--color-text-muted)/60">
                            {ep.turnCount} turns
                          </span>
                        </>
                      )}
                    </div>
                    {ep.topics.length > 0 && (
                      <div className="flex gap-1.5 mt-2">
                        {ep.topics.map((topic) => (
                          <span
                            key={topic}
                            className="text-[9px] px-1.5 py-0.5 bg-(--color-bg-input) border border-(--color-border) rounded uppercase tracking-wider text-(--color-text-muted)"
                          >
                            {topic}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <div
                          key={n}
                          className={`w-1.5 h-1.5 rounded-full ${
                            n <= ep.significanceScore
                              ? "bg-(--color-primary)"
                              : "bg-(--color-border)"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Memory items tabs */}
        {!loading && tab !== "episodes" && (
          <div className="space-y-2 max-w-2xl">
            {items.length === 0 && !showCreate && (
              <div className="text-xs text-(--color-text-muted)">
                No {tab} yet. They're extracted automatically from conversations, or you can add them manually.
              </div>
            )}

            {items.map((item) => (
              <div
                key={item.id}
                className="group bg-(--color-bg-card) border border-(--color-border) rounded-md px-4 py-2.5 flex items-start gap-3"
              >
                {editingId === item.id ? (
                  <div className="flex-1 flex flex-col gap-2">
                    <input
                      type="text"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(item);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="w-full bg-(--color-bg-input) border border-(--color-border) rounded-sm px-2 py-1 text-sm text-(--color-text) outline-none focus:border-(--color-primary)"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(item)}
                        className="text-[10px] text-(--color-text-muted) hover:text-(--color-text) uppercase tracking-wider"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="text-[10px] text-(--color-text-muted) hover:text-(--color-text) uppercase tracking-wider"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-(--color-text) leading-relaxed">
                        {item.content}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] text-(--color-text-muted)/40 uppercase tracking-wider">
                          {IMPORTANCE_LABELS[item.importance] || ""}
                        </span>
                        <span className="text-(--color-border)">·</span>
                        <span className="text-[9px] text-(--color-text-muted)/40 uppercase tracking-wider">
                          {item.source}
                        </span>
                        {item.createdAt && (
                          <>
                            <span className="text-(--color-border)">·</span>
                            <span className="text-[9px] text-(--color-text-muted)/40">
                              {new Date(item.createdAt).toLocaleDateString()}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(item)}
                        className="text-[10px] text-(--color-text-muted) hover:text-(--color-text) uppercase tracking-wider"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="text-[10px] text-(--color-text-muted) hover:text-(--color-danger) uppercase tracking-wider"
                      >
                        Del
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}

            {/* Create new item */}
            {showCreate ? (
              <div className="bg-(--color-bg-card) border border-(--color-primary)/30 rounded-md px-4 py-3 space-y-2.5">
                <input
                  type="text"
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newContent.trim()) handleCreate();
                    if (e.key === "Escape") { setShowCreate(false); setNewContent(""); }
                  }}
                  placeholder={`e.g. "${tab === "facts" ? "Works as a designer" : tab === "preferences" ? "Prefers dark mode" : tab === "goals" ? "Learn Rust this year" : "Has a cat named Luna"}"`}
                  className="w-full bg-(--color-bg-input) border border-(--color-border) rounded-sm px-2 py-1.5 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/40 outline-none focus:border-(--color-primary)"
                  autoFocus
                />
                <div className="flex items-center gap-3">
                  <label className="text-[10px] text-(--color-text-muted) uppercase tracking-wider">
                    Importance
                  </label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setNewImportance(n)}
                        className={`w-5 h-5 rounded text-[10px] border transition-colors ${
                          n === newImportance
                            ? "bg-(--color-primary) text-(--color-bg) border-(--color-primary)"
                            : "bg-(--color-bg-input) text-(--color-text-muted) border-(--color-border) hover:border-(--color-text-muted)"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <span className="text-[9px] text-(--color-text-muted)/50">
                    {IMPORTANCE_LABELS[newImportance]}
                  </span>
                  <div className="ml-auto flex gap-2">
                    <button
                      onClick={() => { setShowCreate(false); setNewContent(""); }}
                      className="text-[10px] text-(--color-text-muted) hover:text-(--color-text) uppercase tracking-wider"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={!newContent.trim()}
                      className="text-[10px] text-(--color-text-muted) hover:text-(--color-text) uppercase tracking-wider disabled:opacity-30"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowCreate(true)}
                className="w-full text-left text-[10px] text-(--color-text-muted)/50 hover:text-(--color-text-muted) uppercase tracking-wider py-2 px-4 border border-dashed border-(--color-border) rounded-md hover:border-(--color-text-muted)/30 transition-colors"
              >
                + Add {categoryForTab(tab)}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
