import { useEffect, useState } from "react";
import { ArrowLeft, Download as DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageMarkdown } from "@/features/chats/components/MessageMarkdown";
import { formatBytes } from "@/features/models/lib/formatBytes";
import { getModelDetail } from "../api/discovery";
import { formatContext } from "../lib/fit";
import type { ModelDetail as ModelDetailData, ModelSource } from "../types";
import { CapabilityBadges, FitBadge } from "./FitBadge";

interface ModelDetailProps {
  id: string;
  source?: ModelSource;
  onBack: () => void;
  onDownload: (ollamaName: string) => void;
}

export function ModelDetail({ id, source = "ollama", onBack, onDownload }: ModelDetailProps) {
  const [detail, setDetail] = useState<ModelDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReadme, setShowReadme] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    getModelDetail(id, source)
      .then((r) => {
        if (cancelled) return;
        if (r.data) setDetail(r.data);
        else setError(r.errors?.[0] ?? "Could not load this model.");
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, source]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack} title="Back to search">
          <ArrowLeft className="size-4" />
        </Button>
        <h3 className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">{id}</h3>
      </div>

      {error && (
        <p className="text-xs text-destructive" data-testid="model-detail-error">
          {error}
        </p>
      )}
      {!detail && !error && <p className="text-xs text-muted-foreground">Loading…</p>}

      {detail && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {detail.card.paramsBillions !== null && (
              <Badge variant="secondary">{detail.card.paramsBillions}B params</Badge>
            )}
            <CapabilityBadges capabilities={detail.card.capabilities} />
            {detail.card.architecture && <span>{detail.card.architecture}</span>}
            {formatContext(detail.card.contextLength) && (
              <span>· {formatContext(detail.card.contextLength)}</span>
            )}
            {detail.card.license && <span>· {detail.card.license}</span>}
          </div>

          {detail.readmeSummary ? (
            <div className="rounded-lg border border-border bg-card p-3 text-sm" data-testid="model-detail-description">
              <MessageMarkdown content={showReadme ? detail.readme : detail.readmeSummary} />
              {detail.readme && (
                <Button
                  variant="link"
                  size="sm"
                  className="mt-1 h-auto p-0"
                  onClick={() => setShowReadme((v) => !v)}
                >
                  {showReadme ? "Show less" : "Read the full model card"}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">This model has no description.</p>
          )}

          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">
              {source === "ollama" ? "Versions" : "Quantizations"}
            </p>
            {source === "huggingface" && (
              <p className="text-xs text-muted-foreground" role="note">
                Not verified with Ollama: this model may fail to load or lack tool support.
              </p>
            )}
            {detail.quantizations.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {source === "ollama"
                  ? "No downloadable versions were found for this model."
                  : "No GGUF files were found for this model."}
              </p>
            )}
            {detail.quantizations.map(({ quant, fit }) => (
              <div
                key={quant.name}
                data-testid={`model-quant-${quant.name}`}
                className="flex flex-col gap-1 rounded-lg border border-border bg-card p-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{quant.name}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(quant.sizeBytes)}</span>
                  {quant.name === detail.bestQuantization && (
                    <Badge variant="outline" data-testid="model-quant-recommended">
                      Recommended
                    </Badge>
                  )}
                  <span className="flex-1" />
                  <FitBadge fit={fit} />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 gap-1 px-3"
                    onClick={() => onDownload(quant.ollamaName)}
                    data-testid="model-quant-download"
                  >
                    <DownloadIcon size={12} />
                    <span>Download</span>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{fit.reason}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
