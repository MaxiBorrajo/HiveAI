import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Cpu, HardDrive, Network, Database } from "lucide-react";
import type { Model } from "../../types/ai.ts";

interface ModelListViewProps {
  models: Model[];
  currentModel?: Model;
  onToggle: (model: Model) => void;
}

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function ModelListView({
  models,
  currentModel,
  onToggle,
}: ModelListViewProps) {
  return (
    <>
      <DialogHeader className="p-6 pb-0">
        <DialogTitle>Available Models</DialogTitle>
      </DialogHeader>

      <ScrollArea className="flex-1 p-6 pt-2">
        <div className="flex flex-col gap-3">
          {models.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No models available.
            </p>
          )}

          {models.map((model) => {
            const isCurrent = currentModel?.name === model.name;

            return (
              <div
                key={model.name}
                className={`flex flex-col gap-3 rounded-lg border p-4 transition-colors ${
                  isCurrent
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{model.name}</h3>
                      {isCurrent && (
                        <Badge
                          variant="default"
                          className="h-5 px-1.5 text-[10px]"
                        >
                          Active
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 mt-2 text-xs text-muted-foreground">
                      <div
                        className="flex items-center gap-1.5"
                        title="Parameter Size"
                      >
                        <Network className="size-3.5" />
                        {model.details?.parameter_size || "Unknown"}
                      </div>
                      <div
                        className="flex items-center gap-1.5"
                        title="Quantization"
                      >
                        <Database className="size-3.5" />
                        {model.details?.quantization_level || "Unknown"}
                      </div>
                      <div className="flex items-center gap-1.5" title="Family">
                        <Cpu className="size-3.5" />
                        {model.details?.family || "Unknown"}
                      </div>
                      <div
                        className="flex items-center gap-1.5"
                        title="File Size"
                      >
                        <HardDrive className="size-3.5" />
                        {formatBytes(model.size)}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant={isCurrent ? "secondary" : "default"}
                    size="sm"
                    className="shrink-0 mt-0.5"
                    disabled={isCurrent}
                    onClick={() => onToggle(model)}
                  >
                    {isCurrent ? (
                      <>
                        <Check className="mr-1.5 size-4" />
                        Selected
                      </>
                    ) : (
                      "Select"
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </>
  );
}
