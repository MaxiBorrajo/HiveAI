import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { CurrentModels, ModelInfo } from "@/types/model";
import { ModelListView } from "./ModelListView";
import { ModelDetailsView } from "./ModelDetailsView";

interface ModelsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  models: ModelInfo[];
  current: CurrentModels;
  onChangeModel: (name: string) => void;
}

export function ModelsModal({
  isOpen,
  onOpenChange,
  models,
  current,
  onChangeModel,
}: ModelsModalProps) {
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);

  function handleOpenChange(open: boolean) {
    if (!open) setSelectedModel(null);
    onOpenChange(open);
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
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
            current={current}
            onChangeModel={onChangeModel}
            onSelectModel={setSelectedModel}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
