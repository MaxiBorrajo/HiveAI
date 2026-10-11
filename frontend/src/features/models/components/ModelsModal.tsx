import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type {
  CurrentModels,
  ModelInfo,
  ModelOptionGroup,
} from "@/features/models/types";
import type { ModelChoice } from "@/features/models/lib/modelChoices";
import { ModelListView } from "./ModelListView";
import { ModelDetailsView } from "./ModelDetailsView";

interface ModelsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  models: ModelInfo[];
  groups: ModelOptionGroup[];
  current: CurrentModels;
  onChangeModel: (choice: ModelChoice) => void;
  onDeleteModel: (name: string) => void;
  // Needed by the app itself (embeddings); listed but never deletable.
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

  // Reset on open, not on close, so the view doesn't swap while the dialog
  // is fading out.
  useEffect(() => {
    if (isOpen) setSelectedModel(null);
  }, [isOpen]);

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
          />
        ) : (
          <ModelListView
            models={models}
            groups={groups}
            current={current}
            onChangeModel={onChangeModel}
            onSelectModel={setSelectedModel}
            onDeleteModel={onDeleteModel}
            protectedModel={protectedModel}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
