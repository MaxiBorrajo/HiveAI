import { useSyncExternalStore } from "react";

export interface ErrorDetails {
  title: string;
  text: string;
}

let current: ErrorDetails | null = null;
const listeners = new Set<() => void>();

function emit(next: ErrorDetails | null) {
  current = next;
  listeners.forEach((listener) => listener());
}

export function openErrorDetails(details: ErrorDetails) {
  emit(details);
}

export function closeErrorDetails() {
  emit(null);
}

export function useErrorDetails(): ErrorDetails | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
