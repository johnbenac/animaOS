import { useState, useRef, useMemo, useEffect } from "react";

export function useVirtualList<T>(items: T[], itemHeight: number, overscan = 5) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      setScrollTop(container.scrollTop);
      setContainerHeight(container.clientHeight);
    };

    update();
    container.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      container.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const { virtualItems, startIndex, totalHeight } = useMemo(() => {
    const start = Math.floor(scrollTop / itemHeight);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const startIndex = Math.max(0, start - overscan);
    const endIndex = Math.min(items.length, start + visibleCount + overscan);

    return {
      virtualItems: items.slice(startIndex, endIndex),
      startIndex,
      totalHeight: items.length * itemHeight,
    };
  }, [items, itemHeight, scrollTop, containerHeight, overscan]);

  return { containerRef, virtualItems, startIndex, totalHeight, itemHeight };
}
