import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "db-query-draft";
const DEBOUNCE_MS = 1000;

export function useQueryDraft() {
  const [draft, setDraft] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved || "";
    } catch {
      return "";
    }
  });

  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Auto-save with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, draft);
        setLastSaved(new Date());
      } catch {
        // Ignore storage errors
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [draft]);

  const updateDraft = useCallback((value: string) => {
    setDraft(value);
  }, []);

  const clearDraft = useCallback(() => {
    setDraft("");
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }, []);

  const restoreDraft = useCallback(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setDraft(saved);
        return saved;
      }
    } catch {
      // Ignore
    }
    return "";
  }, []);

  return {
    draft,
    lastSaved,
    updateDraft,
    clearDraft,
    restoreDraft,
  };
}
