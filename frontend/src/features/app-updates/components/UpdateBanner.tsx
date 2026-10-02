import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { getUpdateStatus } from "../api/getUpdateStatus";

const POLL_INTERVAL_MS = 10 * 60 * 1000;
const DISMISSED_KEY = "hiveai_dismissed_update";

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function saveDismissed(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
  }
}

export function UpdateBanner() {
  const [readyVersion, setReadyVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      getUpdateStatus()
        .then(({ data }) => {
          if (!cancelled) setReadyVersion(data?.readyVersion ?? null);
        })
        .catch(() => {});

    check();
    const timer = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!readyVersion || dismissed === readyVersion) return null;

  return (
    <div className="fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-background/95 px-4 py-2 text-xs shadow-lg backdrop-blur-sm">
      <Download className="size-4 text-primary" />
      <span>
        HiveAI <strong>v{readyVersion}</strong> is ready. It will be applied the next time you open the app.
      </span>
      <button
        type="button"
        onClick={() => {
          saveDismissed(readyVersion);
          setDismissed(readyVersion);
        }}
        className="text-muted-foreground hover:text-foreground"
        title="Dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
