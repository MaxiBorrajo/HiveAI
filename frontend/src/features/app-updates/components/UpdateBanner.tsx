import { useEffect, useState } from "react";
import { Check, Copy, Download, X } from "lucide-react";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { getUpdateStatus, type UpdateStatus } from "../api/getUpdateStatus";

const POLL_INTERVAL_MS = 30 * 60 * 1000;
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
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);
  const { copied, copy } = useCopyFeedback();

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      getUpdateStatus()
        .then(({ data }) => {
          if (!cancelled) setStatus(data ?? null);
        })
        .catch(() => {});

    check();
    const timer = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const version = status?.latestVersion;
  if (!status?.updateAvailable || !version || dismissed === version) return null;

  return (
    <div className="fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-background/95 px-4 py-2 text-xs shadow-lg backdrop-blur-sm">
      <Download className="size-4 text-primary" />
      <span>
        HiveAI <strong>v{version}</strong> is available.
      </span>
      {status.downloadUrl && (
        <>
          <a
            href={status.downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary hover:underline"
          >
            Download
          </a>
          <button
            type="button"
            onClick={() => copy(status.downloadUrl!)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            title="Copy the download link"
          >
            {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          </button>
        </>
      )}
      <button
        type="button"
        onClick={() => {
          saveDismissed(version);
          setDismissed(version);
        }}
        className="text-muted-foreground hover:text-foreground"
        title="Dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
