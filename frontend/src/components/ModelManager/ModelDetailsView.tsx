import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import type { ModelInfo } from "@/types/model";
import { formatBytes } from "@/lib/models/formatBytes";

interface ModelDetailsViewProps {
  model: ModelInfo;
  onBack: () => void;
}

export function ModelDetailsView({ model, onBack }: ModelDetailsViewProps) {
  return (
    <>
      <DialogHeader className="p-6 pb-0 flex flex-row items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          title="Back to model list"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <DialogTitle className="font-mono truncate">{model.name}</DialogTitle>
      </DialogHeader>

      <ScrollArea className="flex-1 p-6 pt-2">
        <div className="flex flex-col gap-4">
          {model.capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {model.capabilities.map((capability) => (
                <Badge key={capability} variant="secondary">
                  {capability}
                </Badge>
              ))}
            </div>
          )}

          <DetailSection title="Overview">
            <DetailRow label="Architecture" value={model.architecture} />
            <DetailRow label="Family" value={model.family} />
            {model.families.length > 0 && (
              <DetailRow label="Families" value={model.families.join(", ")} />
            )}
            <DetailRow label="Format" value={model.format} />
            {model.parentModel && (
              <DetailRow label="Parent model" value={model.parentModel} />
            )}
          </DetailSection>

          <DetailSection title="Size & quantization">
            <DetailRow label="Size" value={formatBytes(model.sizeBytes)} />
            <DetailRow
              label="Parameter count"
              value={model.parameterCount?.toLocaleString()}
            />
            <DetailRow label="Parameter size" value={model.parameterSize} />
            <DetailRow
              label="Quantization level"
              value={model.quantizationLevel}
            />
            <DetailRow
              label="Quantization version"
              value={model.quantizationVersion?.toString()}
            />
          </DetailSection>

          <DetailSection title="Architecture details">
            <DetailRow
              label="Layer count"
              value={model.layerCount?.toString()}
            />
            <DetailRow
              label="Bytes per layer"
              value={formatBytes(model.bytesPerLayer)}
            />
            <DetailRow
              label="Context length"
              value={model.contextLength?.toLocaleString()}
            />
            <DetailRow
              label="Embedding length"
              value={model.embeddingLength?.toLocaleString()}
            />
            <DetailRow
              label="Feed-forward length"
              value={model.feedForwardLength?.toLocaleString()}
            />
            <DetailRow label="Head count" value={model.headCount?.toString()} />
            <DetailRow
              label="Head count (KV)"
              value={model.headCountKV?.toString()}
            />
          </DetailSection>

          <DetailSection title="Metadata">
            <DetailRow label="Digest" value={model.digest} mono />
            <DetailRow
              label="Modified at"
              value={
                model.modifiedAt
                  ? new Date(model.modifiedAt).toLocaleString()
                  : undefined
              }
            />
          </DetailSection>
        </div>
      </ScrollArea>
    </>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-semibold mb-3">{title}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | number;
  mono?: boolean;
}) {
  if (value === undefined || value === null || value === "") return null;

  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span
        className={`truncate text-right ${mono ? "font-mono" : ""}`}
        title={String(value)}
      >
        {value}
      </span>
    </div>
  );
}
