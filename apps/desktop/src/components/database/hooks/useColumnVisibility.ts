import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";

export function useColumnVisibility(tableName: string | null, allColumns: string[]) {
  const [hiddenColumnsMap, setHiddenColumnsMap] = useLocalStorage<Record<string, string[]>>(
    "db-hidden-columns",
    {}
  );

  const hiddenColumns = tableName ? hiddenColumnsMap[tableName] || [] : [];
  
  const visibleColumns = allColumns.filter((col) => !hiddenColumns.includes(col));

  const toggleColumn = useCallback(
    (column: string) => {
      if (!tableName) return;
      
      setHiddenColumnsMap((prev) => {
        const current = new Set(prev[tableName] || []);
        if (current.has(column)) {
          current.delete(column);
        } else {
          current.add(column);
        }
        return {
          ...prev,
          [tableName]: Array.from(current),
        };
      });
    },
    [tableName, setHiddenColumnsMap]
  );

  const showAllColumns = useCallback(() => {
    if (!tableName) return;
    
    setHiddenColumnsMap((prev) => ({
      ...prev,
      [tableName]: [],
    }));
  }, [tableName, setHiddenColumnsMap]);

  const hideAllColumns = useCallback(() => {
    if (!tableName) return;
    
    setHiddenColumnsMap((prev) => ({
      ...prev,
      [tableName]: allColumns,
    }));
  }, [tableName, allColumns, setHiddenColumnsMap]);

  const isVisible = useCallback(
    (column: string) => !hiddenColumns.includes(column),
    [hiddenColumns]
  );

  return {
    visibleColumns,
    hiddenColumns,
    toggleColumn,
    showAllColumns,
    hideAllColumns,
    isVisible,
  };
}
