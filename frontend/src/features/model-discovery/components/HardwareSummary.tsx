import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { formatBytes } from "@/features/models/lib/formatBytes";
import { getHardwareReport } from "../api/discovery";
import type { HardwareReport } from "../types";

export function HardwareSummary() {
  const [report, setReport] = useState<HardwareReport | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHardwareReport()
      .then((r) => !cancelled && (r.data ? setReport(r.data) : setError(true)))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p className="text-xs text-muted-foreground">
        Could not detect this computer's hardware, so models are not rated.
      </p>
    );
  }
  if (!report) {
    return <p className="text-xs text-muted-foreground">Detecting hardware…</p>;
  }

  const { profile, context, plugins } = report;
  const gpu = profile.gpu.usable
    ? profile.gpu.unifiedMemory
      ? `${profile.gpu.name ?? "GPU"} (shared memory)`
      : `${profile.gpu.name ?? "GPU"} · ${formatBytes(profile.gpu.vramBytes ?? 0)} VRAM`
    : "No usable GPU";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Cpu size={14} />
        <span>Your computer</span>
      </div>
      <p className="text-muted-foreground" data-testid="hardware-memory">
        {formatBytes(profile.totalMemBytes)} RAM ({formatBytes(profile.availableMemBytes)} free)
        {" · "}
        {gpu}
      </p>
      <p className="text-muted-foreground" data-testid="hardware-plugins">
        {plugins.length > 0
          ? `Your ${plugins.length} active plugin${plugins.length === 1 ? "" : "s"} use about ${context.pluginTokens.toLocaleString()} of the ${context.nCtx.toLocaleString()}-token context.`
          : "No active plugins are using context."}
      </p>
      {report.noToolModelFits && (
        <div
          role="alert"
          data-testid="hardware-warning"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive"
        >
          <p className="font-medium">
            No local model with tool support runs well on this computer.
          </p>
          <p>
            {report.cloudSuggestion
              ? `Consider the cloud model ${report.cloudSuggestion.model} (${report.cloudSuggestion.provider}, key "${report.cloudSuggestion.alias}") instead.`
              : report.hasCloudKey
                ? "Your API keys list no cloud model with tool support; check them in the API keys menu."
                : "Add a cloud API key (for example Anthropic or Google) in the API keys menu to use a cloud model instead."}
          </p>
        </div>
      )}
    </div>
  );
}
