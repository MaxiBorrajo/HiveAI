import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";
import type { CurrentModels, ModelInfo } from "@/types/model";
import { formatBytes } from "@/lib/models/formatBytes";

interface ModelListViewProps {
  models: ModelInfo[];
  current: CurrentModels;
  onChangeModel: (name: string) => void;
  onChangeSelectorModel: (name: string) => void;
  onSelectModel: (model: ModelInfo) => void;
}

export function ModelListView({
  models,
  current,
  onChangeModel,
  onChangeSelectorModel,
  onSelectModel,
}: ModelListViewProps) {
  return (
    <>
      <DialogHeader className="p-6 pb-0">
        <DialogTitle>Manage Models</DialogTitle>
      </DialogHeader>

      <ScrollArea className="flex-1 p-6 pt-2">
        <div className="flex flex-col gap-3">
          {models.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No models found. Make sure Ollama is running and has models
              pulled.
            </p>
          )}

          {models.map((model) => {
            const isModel = model.name === current.model;
            const isSelectorModel = model.name === current.selectorModel;

            return (
              <div
                key={model.name}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm font-semibold flex items-center flex-wrap gap-2 mb-2">
                      {model.name}
                      {isModel && <Badge variant="default">Respond</Badge>}
                      {isSelectorModel && (
                        <Badge variant="secondary">Selector</Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {model.parameterSize} · {model.quantizationLevel} ·{" "}
                      {formatBytes(model.sizeBytes)}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onSelectModel(model)}
                      className="h-8 gap-1 px-3"
                    >
                      <Info size={12} />
                      <span>Details</span>
                    </Button>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant={isModel ? "default" : "outline"}
                    size="sm"
                    disabled={isModel}
                    onClick={() => onChangeModel(model.name)}
                    title="Used to respond to messages and verify results. Prefer a larger, more capable model here."
                  >
                    Use to respond &amp; verify
                  </Button>
                  <Button
                    variant={isSelectorModel ? "default" : "outline"}
                    size="sm"
                    disabled={isSelectorModel}
                    onClick={() => onChangeSelectorModel(model.name)}
                    title="Used to quickly select which plugins to run. Prefer a smaller, faster model here."
                  >
                    Use as tool selector
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
