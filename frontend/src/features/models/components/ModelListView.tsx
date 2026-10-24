import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Info, Trash2 } from "lucide-react";
import type {
  CurrentModels,
  ModelInfo,
  ModelOptionGroup,
  ModelProvider,
  ToolSupport,
} from "@/features/models/types";
import { formatBytes } from "@/features/models/lib/formatBytes";
import {
  buildProviderTree,
  canUse,
  currentChoice,
  PROVIDER_LABELS,
  sameChoice,
  type ModelChoice,
  type ProviderModel,
} from "@/features/models/lib/modelChoices";

interface ModelListViewProps {
  models: ModelInfo[];
  groups: ModelOptionGroup[];
  current: CurrentModels;
  onChangeModel: (choice: ModelChoice) => void;
  onSelectModel: (model: ModelInfo) => void;
  onDeleteModel: (name: string) => void;
  protectedModel?: string;
}

function SupportBadge({ support }: { support?: ToolSupport }) {
  if (support?.status === "unsupported") {
    return <Badge variant="destructive">No tool support</Badge>;
  }
  if (support?.status === "unknown") {
    return <Badge variant="outline">Tools unverified</Badge>;
  }
  return null;
}

function SupportReason({ support }: { support?: ToolSupport }) {
  if (!support || support.status === "supported" || !support.reason) {
    return null;
  }
  return (
    <p
      className={
        support.status === "unsupported"
          ? "text-xs text-destructive"
          : "text-xs text-muted-foreground"
      }
    >
      {support.status === "unsupported"
        ? `Cannot be selected: ${support.reason}`
        : support.reason}
    </p>
  );
}

export function ModelListView({
  models,
  groups,
  current,
  onChangeModel,
  onSelectModel,
  onDeleteModel,
  protectedModel,
}: ModelListViewProps) {
  const active = currentChoice(current);
  const tree = buildProviderTree(groups, { includeUnsupported: true });
  const localEntry = tree.find((e) => e.provider === "ollama");
  const cloudEntries = tree.filter((e) => e.provider !== "ollama");
  const providers: { provider: ModelProvider; label: string }[] = [
    { provider: "ollama", label: PROVIDER_LABELS.ollama },
    ...cloudEntries.map((e) => ({ provider: e.provider, label: e.label })),
  ];

  return (
    <>
      <DialogHeader className="p-6 pb-0">
        <DialogTitle>Manage Models</DialogTitle>
      </DialogHeader>

      <Tabs defaultValue="ollama" className="flex-1 min-h-0 px-6 pt-2 pb-6">
        <TabsList>
          {providers.map((p) => (
            <TabsTrigger key={p.provider} value={p.provider}>
              {p.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="ollama" className="flex flex-1 min-h-0 flex-col">
          <ScrollArea className="flex-1 min-h-0">
            <div className="flex flex-col gap-3">
              {models.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No models found. Make sure Ollama is running and has models
                  pulled.
                </p>
              )}

              {models.map((model) => {
                const support = localEntry?.models.find(
                  (m) => m.model === model.name,
                )?.toolSupport;
                const choice: ModelChoice = {
                  provider: "ollama",
                  model: model.name,
                  keyId: "",
                };
                const isActive = sameChoice(choice, active);
                const usable = canUse(support);
                const isProtected =
                  !!protectedModel && model.name.startsWith(protectedModel);

                return (
                  <div
                    key={model.name}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm font-semibold flex items-center flex-wrap gap-2 mb-2">
                          {model.name}
                          {isActive && <Badge variant="default">Active</Badge>}
                          <SupportBadge support={support} />
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {model.parameterSize} · {model.quantizationLevel} ·{" "}
                          {formatBytes(model.sizeBytes)}
                        </p>
                        <SupportReason support={support} />
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
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isActive || isProtected}
                          title={
                            isProtected
                              ? "Used for conversation memory; it cannot be deleted"
                              : isActive
                                ? "Select another model before deleting this one"
                                : "Delete from this computer"
                          }
                          onClick={() => {
                            if (
                              globalThis.confirm(
                                `Delete '${model.name}' from this computer?`,
                              )
                            ) {
                              onDeleteModel(model.name);
                            }
                          }}
                          className="h-8 gap-1 px-3"
                        >
                          <Trash2 size={12} />
                          <span>Delete</span>
                        </Button>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant={isActive ? "default" : "outline"}
                        size="sm"
                        disabled={isActive || !usable}
                        onClick={() => onChangeModel(choice)}
                      >
                        Use this model
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </TabsContent>

        {cloudEntries.map((entry) => (
          <TabsContent
            key={entry.provider}
            value={entry.provider}
            className="flex flex-1 min-h-0 flex-col"
          >
            <ScrollArea className="flex-1 min-h-0">
              <div className="flex flex-col gap-3">
                {entry.keyErrors.map((e) => (
                  <p key={e.alias} className="text-xs text-destructive">
                    ⚠ {e.alias}: {e.error}
                  </p>
                ))}
                {entry.models.length === 0 && entry.keyErrors.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No models found for this provider.
                  </p>
                )}
                {entry.models.map((m: ProviderModel) => (
                  <div
                    key={m.model}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
                  >
                    <p className="font-mono text-sm font-semibold flex items-center flex-wrap gap-2">
                      {m.model}
                      <SupportBadge support={m.toolSupport} />
                    </p>
                    <SupportReason support={m.toolSupport} />
                    <div className="flex flex-wrap gap-2">
                      {m.keys.map((k) => {
                        const choice: ModelChoice = {
                          provider: entry.provider,
                          model: m.model,
                          keyId: k.keyId,
                        };
                        const isActive = sameChoice(choice, active);
                        return (
                          <Button
                            key={k.keyId}
                            variant={isActive ? "default" : "outline"}
                            size="sm"
                            disabled={isActive || !canUse(m.toolSupport)}
                            onClick={() => onChangeModel(choice)}
                          >
                            {isActive ? "Active" : "Use"} · {k.alias}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
