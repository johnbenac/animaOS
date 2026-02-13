import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

interface MemoryEntry {
  path: string;
  meta: {
    category: string;
    tags: string[];
    created: string;
    updated: string;
    source: string;
  };
  snippet: string;
}

interface MemoryFile {
  path: string;
  meta: {
    category: string;
    tags: string[];
    created: string;
    updated: string;
    source: string;
  };
  content: string;
}

export default function Memory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<MemoryFile | null>(null);
  const [section, setSection] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");

  const sections = ["all", "user", "knowledge", "relationships", "journal"];

  // Load memories
  useEffect(() => {
    if (!user?.id) return;
    loadMemories();
  }, [user?.id, section]);

  const loadMemories = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const url =
        section === "all"
          ? `http://localhost:3031/api/memory/${user.id}`
          : `http://localhost:3031/api/memory/${user.id}?section=${section}`;
      const res = await fetch(url);
      const data = await res.json();
      setMemories(data.memories || []);
    } catch (err) {
      console.error("Failed to load memories:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!user?.id || !searchQuery.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(
        `http://localhost:3031/api/memory/${user.id}/search?q=${encodeURIComponent(searchQuery)}`,
      );
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const openFile = async (path: string) => {
    if (!user?.id) return;
    setLoading(true);
    setIsEditing(false);
    try {
      const parts = path.split("/");
      const section = parts[0];
      const filename = parts.slice(2).join("/");
      const res = await fetch(
        `http://localhost:3031/api/memory/${user.id}/${section}/${filename}`,
      );
      const data = await res.json();
      setSelectedFile(data);
      setEditContent(data.content);
    } catch (err) {
      console.error("Failed to open file:", err);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = () => {
    if (selectedFile) {
      setEditContent(selectedFile.content);
      setIsEditing(true);
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    if (selectedFile) {
      setEditContent(selectedFile.content);
    }
  };

  const saveFile = async () => {
    if (!user?.id || !selectedFile) return;
    setLoading(true);
    try {
      const parts = selectedFile.path.split("/");
      const section = parts[0];
      const filename = parts.slice(2).join("/");
      await fetch(
        `http://localhost:3031/api/memory/${user.id}/${section}/${filename}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: editContent,
            tags: selectedFile.meta.tags,
          }),
        },
      );
      // Reload the file
      await openFile(selectedFile.path);
      setIsEditing(false);
      loadMemories();
    } catch (err) {
      console.error("Failed to save file:", err);
    } finally {
      setLoading(false);
    }
  };

  const deleteFile = async (path: string) => {
    if (!user?.id || !confirm("Delete this memory file?")) return;
    try {
      const parts = path.split("/");
      const section = parts[0];
      const filename = parts.slice(2).join("/");
      await fetch(
        `http://localhost:3031/api/memory/${user.id}/${section}/${filename}`,
        { method: "DELETE" },
      );
      setSelectedFile(null);
      loadMemories();
    } catch (err) {
      console.error("Failed to delete file:", err);
    }
  };

  const groupBySection = (entries: MemoryEntry[]) => {
    return entries.reduce(
      (acc, entry) => {
        const section = entry.path.split("/")[0];
        if (!acc[section]) acc[section] = [];
        acc[section].push(entry);
        return acc;
      },
      {} as Record<string, MemoryEntry[]>,
    );
  };

  const displayMemories = searchQuery ? searchResults : memories;
  const grouped = groupBySection(displayMemories);

  return (
    <div className="flex h-screen bg-(--color-bg) text-(--color-text) font-(family-name:--font-mono)">
      {/* Sidebar - File Tree */}
      <div className="w-80 border-r border-(--color-border) flex flex-col">
        {/* Header */}
        <header className="px-4 py-3 border-b border-(--color-border)">
          <div className="flex items-center gap-4 mb-3">
            <button
              onClick={() => navigate("/")}
              className="text-(--color-text-muted) hover:text-(--color-text) text-xs uppercase tracking-wider"
            >
              ← SYS
            </button>
            <span className="text-sm tracking-widest uppercase">
              ▸ MEMORY
              <span className="text-(--color-text-muted)">::EXPLORER</span>
            </span>
          </div>

          {/* Section Filter */}
          <div className="flex gap-1 mb-3 flex-wrap">
            {sections.map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`text-xs px-2 py-1 rounded uppercase tracking-wider transition-colors ${
                  section === s
                    ? "bg-(--color-primary) text-(--color-bg)"
                    : "bg-(--color-bg-card) text-(--color-text-muted) hover:text-(--color-text)"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search memories..."
              className="flex-1 bg-(--color-bg-input) border border-(--color-border) rounded px-2 py-1 text-xs text-(--color-text) placeholder:text-(--color-text-muted)/50 outline-none focus:border-(--color-primary)"
            />
            <button
              onClick={handleSearch}
              className="text-xs text-(--color-text-muted) hover:text-(--color-text) uppercase tracking-wider"
            >
              →
            </button>
          </div>
        </header>

        {/* File List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="text-(--color-text-muted) text-xs">Loading...</div>
          )}

          {!loading && displayMemories.length === 0 && (
            <div className="text-(--color-text-muted) text-xs">
              {searchQuery ? "No results found" : "No memories yet"}
            </div>
          )}

          {!loading &&
            Object.entries(grouped).map(([sectionName, entries]) => (
              <div key={sectionName} className="mb-4">
                <div className="text-xs text-(--color-text-muted) uppercase tracking-wider mb-2 flex items-center gap-2">
                  <span className="text-(--color-primary)">▸</span>
                  {sectionName}
                </div>
                <div className="space-y-1 pl-3">
                  {entries.map((entry) => (
                    <button
                      key={entry.path}
                      onClick={() => openFile(entry.path)}
                      className={`block w-full text-left text-xs px-2 py-1.5 rounded hover:bg-(--color-bg-card) transition-colors ${
                        selectedFile?.path === entry.path
                          ? "bg-(--color-bg-card) text-(--color-primary)"
                          : "text-(--color-text)"
                      }`}
                    >
                      <div className="font-mono truncate">
                        {entry.path.split("/").pop()?.replace(".md", "")}
                      </div>
                      <div className="text-(--color-text-muted) text-[10px] mt-0.5 truncate">
                        {entry.snippet}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Main Content - File Viewer */}
      <div className="flex-1 flex flex-col">
        {selectedFile ? (
          <>
            {/* File Header */}
            <header className="px-6 py-4 border-b border-(--color-border)">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-sm font-mono tracking-wider uppercase mb-2">
                    {selectedFile.path}
                  </h1>
                  <div className="flex gap-3 text-xs text-(--color-text-muted)">
                    <span>Category: {selectedFile.meta.category}</span>
                    <span>•</span>
                    <span>
                      Updated:{" "}
                      {new Date(selectedFile.meta.updated).toLocaleDateString()}
                    </span>
                    <span>•</span>
                    <span>Source: {selectedFile.meta.source}</span>
                  </div>
                  {selectedFile.meta.tags.length > 0 && (
                    <div className="flex gap-2 mt-2">
                      {selectedFile.meta.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-2 py-0.5 bg-(--color-bg-card) border border-(--color-border) rounded uppercase tracking-wider"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  {isEditing ? (
                    <>
                      <button
                        onClick={cancelEdit}
                        className="text-xs text-(--color-text-muted) hover:text-(--color-text) uppercase tracking-wider"
                      >
                        CANCEL
                      </button>
                      <button
                        onClick={saveFile}
                        disabled={loading}
                        className="text-xs text-(--color-text-muted) hover:text-(--color-success) uppercase tracking-wider disabled:opacity-50"
                      >
                        SAVE
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={startEdit}
                        className="text-xs text-(--color-text-muted) hover:text-(--color-text) uppercase tracking-wider"
                      >
                        EDIT
                      </button>
                      <button
                        onClick={() => deleteFile(selectedFile.path)}
                        className="text-xs text-(--color-text-muted) hover:text-(--color-danger) uppercase tracking-wider"
                      >
                        DEL
                      </button>
                    </>
                  )}
                </div>
              </div>
            </header>

            {/* File Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {isEditing ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-full bg-(--color-bg-input) border border-(--color-border) rounded px-3 py-2 text-sm text-(--color-text) font-mono leading-relaxed outline-none focus:border-(--color-primary) resize-none"
                  spellCheck={false}
                />
              ) : (
                <pre className="text-sm text-(--color-text) whitespace-pre-wrap font-mono leading-relaxed">
                  {selectedFile.content}
                </pre>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-(--color-text-muted) text-sm tracking-wider uppercase mb-2">
                // NO FILE SELECTED
              </p>
              <p className="text-(--color-text-muted) text-xs">
                Select a memory file from the sidebar
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
