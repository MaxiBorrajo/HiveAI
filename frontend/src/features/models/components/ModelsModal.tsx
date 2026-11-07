import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  CurrentModels,
  ModelInfo,
  ModelOptionGroup,
} from "@/features/models/types";
import {
  allModelChoices,
  PROVIDER_LABELS,
  type ModelChoice,
} from "@/features/models/lib/modelChoices";
import { ModelListView } from "./ModelListView";
import { ModelDetailsView } from "./ModelDetailsView";
import { EvalProfilePanel } from "./EvalProfilePanel";

interface ModelsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  models: ModelInfo[];
  groups: ModelOptionGroup[];
  current: CurrentModels;
  onChangeModel: (choice: ModelChoice) => void;
  onDeleteModel: (name: string) => void;
  protectedModel?: string;
}

export function ModelsModal({
  isOpen,
  onOpenChange,
  models,
  groups,
  current,
  onChangeModel,
  onDeleteModel,
  protectedModel,
}: ModelsModalProps) {
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [evaluatedCloudModel, setEvaluatedCloudModel] = useState<ModelChoice | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedModel(null);
      setEvaluatedCloudModel(null);
    }
  }, [isOpen]);

  const judgeChoices = allModelChoices(groups);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[90vw] max-w-3xl sm:max-w-[90vw] md:max-w-[90vw] lg:max-w-3xl h-[80vh] p-0 flex flex-col overflow-scroll"
        showCloseButton
      >
        {selectedModel ? (
          <ModelDetailsView
            model={selectedModel}
            onBack={() => setSelectedModel(null)}
            judgeChoices={judgeChoices}
          />
        ) : evaluatedCloudModel ? (
          <>
            <DialogHeader className="p-6 pb-0 flex flex-row items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setEvaluatedCloudModel(null)}
                title="Back to model list"
              >
                <ArrowLeft className="size-4" />
              </Button>
              <DialogTitle className="font-mono truncate">
                {evaluatedCloudModel.model}
                <span className="ml-2 text-xs font-sans font-normal text-muted-foreground">
                  {PROVIDER_LABELS[evaluatedCloudModel.provider]}
                </span>
              </DialogTitle>
            </DialogHeader>
            <ScrollArea className="flex-1 p-6 pt-2">
              <EvalProfilePanel model={evaluatedCloudModel} judgeChoices={judgeChoices} />
            </ScrollArea>
          </>
        ) : (
          <ModelListView
            models={models}
            groups={groups}
            current={current}
            onChangeModel={onChangeModel}
            onSelectModel={setSelectedModel}
            onEvaluateModel={setEvaluatedCloudModel}
            onDeleteModel={onDeleteModel}
            protectedModel={protectedModel}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
