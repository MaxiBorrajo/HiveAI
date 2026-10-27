import { useEffect, useState } from "react";
import { Download as DownloadIcon, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDownloads } from "@/features/models/DownloadsContext";
import {
  getPreflight,
  type Download,
  type Preflight,
} from "@/features/models/api/downloads";
import { formatBytes } from "@/features/models/lib/formatBytes";
import { formatSpeed } from "@/features/models/lib/formatSpeed";

const SUGGESTED = ["gemma3n:e4b", "qwen3:8b", "llama3.2:3b", "qwen3:0.6b"];

const STATUS_LABEL: Record<Download["status"], string> = {
  queued: "Queued",
  downloading: "Downloading",
  completed: "Installed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function PreflightNotice({ info }: { info: Preflight }) {
  if (info.ollama !== "ok") {
    return (
      <p className="text-xs text-destructive">
        {info.ollamaMessage ?? "Ollama is not available."}
      </p>
    );
  }
  if (info.installed) {
    return (
      <p className="text-xs text-muted-foreground">
        This model is already installed.
      </p>
    );
  }
  if (!info.exists) {
    return (
      <p className="text-xs text-destructive">
        This model was not found in the Ollama registry. Check the name and tag.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <p>
        Download size: {info.sizeBytes ? formatBytes(info.sizeBytes) : "unknown"}
        {" · "}
        Free disk space:{" "}
        {info.freeBytes !== null ? formatBytes(info.freeBytes) : "unknown"}
      </p>
      {info.enoughSpace === false && (
        <p className="text-destructive">
          Not enough free disk space for this model. Free some space or delete a
          model you no longer use before downloading.
        </p>
      )}
    </div>
  );
}

function DownloadRow({ item }: { item: Download }) {
  const { cancel, retry } = useDownloads();
  const percent =
    item.total > 0 ? Math.min(100, Math.floor((item.completed / item.total) * 100)) : 0;
  const active = item.status === "queued" || item.status === "downloading";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
          {item.name}
        </p>
        <Badge variant={item.status === "failed" ? "destructive" : "outline"}>
          {STATUS_LABEL[item.status]}
        </Badge>
        {active && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 px-3"
            onClick={() => cancel(item.id)}
          >
            <X size={12} />
            <span>Cancel</span>
          </Button>
        )}
        {(item.status === "failed" || item.status === "cancelled") && (
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1 px-3"
            onClick={() => retry(item.id)}
          >
            <RotateCcw size={12} />
            <span>Retry</span>
          </Button>
        )}
      </div>

      {item.status === "downloading" && (
        <>
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {item.total > 0
              ? `${percent}% · ${formatBytes(item.completed)} of ${formatBytes(item.total)} · ${formatSpeed(item.bytesPerSec)}`
              : item.phase}
          </p>
        </>
      )}
      {item.status === "completed" && (
        <p className="text-xs text-muted-foreground">
          Ready in the chat and node selectors.
          {item.capabilities && item.capabilities.length > 0 &&
            ` Capabilities: ${item.capabilities.join(", ")}.`}
        </p>
      )}
      {item.error && <p className="text-xs text-destructive">{item.error}</p>}
    </div>
  );
}

export function ModelDownloadView() {
  const { downloads, start, requestedName, clearRequest } = useDownloads();
  const [name, setName] = useState("");
  const [info, setInfo] = useState<Preflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  useEffect(() => {
    if (requestedName) {
      setName(requestedName);
      clearRequest();
    }
  }, [requestedName, clearRequest]);

  useEffect(() => {
    const trimmed = name.trim();
    setInfo(null);
    setCheckError(null);
    if (!trimmed) return;
    setChecking(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      getPreflight(trimmed)
        .then((result) => !cancelled && setInfo(result))
        .catch((e: Error) => !cancelled && setCheckError(e.message))
        .finally(() => !cancelled && setChecking(false));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name]);

  const blocked =
    !name.trim() ||
    !!checkError ||
    (info !== null &&
      (info.ollama !== "ok" || !info.exists || info.installed));

  async function submit() {
    if (blocked) return;
    if (
      info?.enoughSpace === false &&
      !globalThis.confirm(
        "There may not be enough free disk space for this model. Download anyway?",
      )
    ) {
      return;
    }
    await start(name.trim());
    setName("");
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            value={name}
            placeholder="name:tag, for example gemma3n:e4b"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <Button onClick={() => void submit()} disabled={blocked} className="gap-1">
            <DownloadIcon size={14} />
            <span>Download</span>
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED.map((s) => (
            <Button
              key={s}
              variant="outline"
              size="sm"
              className="h-7 px-2 font-mono text-xs"
              onClick={() => setName(s)}
            >
              {s}
            </Button>
          ))}
        </div>
        {checking && (
          <p className="text-xs text-muted-foreground">Checking…</p>
        )}
        {checkError && <p className="text-xs text-destructive">{checkError}</p>}
        {info && !checking && <PreflightNotice info={info} />}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-3">
          {downloads.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No downloads yet. Pick a model above to get started.
            </p>
          )}
          {[...downloads].reverse().map((d) => (
            <DownloadRow key={d.id} item={d} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
