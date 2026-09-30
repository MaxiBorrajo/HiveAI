import { useEffect, useState } from "react";

export interface ResizableSidebarOptions {
  /** localStorage key used to persist the chosen width across sessions. */
  storageKey: string;
  /** Minimum sidebar width in px. */
  minWidth: number;
  /** Default width used when there's no persisted value, and the floor for `maxWidth`. */
  defaultWidth: number;
  /** How much viewport width to always leave visible on the opposite side. */
  reservedViewportWidth: number;
}

export interface ResizableSidebar {
  width: number;
  isResizing: boolean;
  isMaximized: boolean;
  startResizing: () => void;
  toggleMaximize: () => void;
}

/**
 * Generic "drag the left edge to resize, persist width in localStorage"
 * mechanic behind a right-docked sidebar. Extracted from
 * ExecutionResultSidebar, which had no dependency on execution-specific
 * state for this — any future slide-over panel can reuse it.
 */
export function useResizableSidebar({
  storageKey,
  minWidth,
  defaultWidth,
  reservedViewportWidth,
}: ResizableSidebarOptions): ResizableSidebar {
  const maxWidth = () =>
    typeof window === "undefined"
      ? defaultWidth
      : Math.max(minWidth, window.innerWidth - reservedViewportWidth);

  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return defaultWidth;
    const saved = localStorage.getItem(storageKey);
    const parsed = saved ? parseInt(saved, 10) : defaultWidth;
    return Math.max(minWidth, Math.min(parsed, maxWidth()));
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.min(
        Math.max(window.innerWidth - e.clientX, minWidth),
        maxWidth(),
      );
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResizing]);

  useEffect(() => {
    if (!isResizing && typeof window !== "undefined") {
      localStorage.setItem(storageKey, String(width));
    }
  }, [width, isResizing, storageKey]);

  const isMaximized =
    typeof window !== "undefined" && width >= window.innerWidth - reservedViewportWidth - 20;

  const toggleMaximize = () => {
    if (typeof window === "undefined") return;
    const max = maxWidth();
    setWidth((prev) => (prev >= max - 40 ? defaultWidth : max));
  };

  return {
    width,
    isResizing,
    isMaximized,
    startResizing: () => setIsResizing(true),
    toggleMaximize,
  };
}
