import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";

export interface TablePreferences {
  viewMode: "list" | "cards" | "compact";
  pageSize: number;
  visibleColumns: string[];
  hiddenColumns: string[];
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  columnWidths: Record<string, number>;
  filters: Array<{
    column: string;
    operator: string;
    value: string;
  }>;
}

const defaultPreferences: TablePreferences = {
  viewMode: "list",
  pageSize: 100,
  visibleColumns: [],
  hiddenColumns: [],
  columnWidths: {},
  filters: [],
};

export function useTablePreferences() {
  const [preferences, setPreferences] = useLocalStorage<Record<string, TablePreferences>>(
    "db-table-preferences",
    {}
  );

  const getTablePreference = useCallback(
    (tableName: string): TablePreferences => {
      return preferences[tableName] || defaultPreferences;
    },
    [preferences]
  );

  const setTablePreference = useCallback(
    (tableName: string, updates: Partial<TablePreferences>) => {
      setPreferences((prev) => ({
        ...prev,
        [tableName]: {
          ...(prev[tableName] || defaultPreferences),
          ...updates,
        },
      }));
    },
    [setPreferences]
  );

  const resetTablePreference = useCallback(
    (tableName: string) => {
      setPreferences((prev) => {
        const next = { ...prev };
        delete next[tableName];
        return next;
      });
    },
    [setPreferences]
  );

  const toggleColumnVisibility = useCallback(
    (tableName: string, column: string) => {
      setPreferences((prev) => {
        const current = prev[tableName] || defaultPreferences;
        const hidden = new Set(current.hiddenColumns);
        
        if (hidden.has(column)) {
          hidden.delete(column);
        } else {
          hidden.add(column);
        }
        
        return {
          ...prev,
          [tableName]: {
            ...current,
            hiddenColumns: Array.from(hidden),
          },
        };
      });
    },
    [setPreferences]
  );

  const setColumnWidth = useCallback(
    (tableName: string, column: string, width: number) => {
      setPreferences((prev) => {
        const current = prev[tableName] || defaultPreferences;
        return {
          ...prev,
          [tableName]: {
            ...current,
            columnWidths: {
              ...current.columnWidths,
              [column]: width,
            },
          },
        };
      });
    },
    [setPreferences]
  );

  return {
    preferences,
    getTablePreference,
    setTablePreference,
    resetTablePreference,
    toggleColumnVisibility,
    setColumnWidth,
  };
}
