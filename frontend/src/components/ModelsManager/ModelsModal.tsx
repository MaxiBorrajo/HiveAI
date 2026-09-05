import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { Model } from "../../types/ai.ts";
import { ModelListView } from "./ModelListView.tsx";

interface ModelsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  models: Model[];
  currentModel?: Model;
  onToggle: (model: Model) => void;
}

export function ModelsModal({
  isOpen,
  onOpenChange,
  models,
  currentModel,
  onToggle,
}: ModelsModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[90vw] max-w-3xl sm:max-w-[90vw] md:max-w-[90vw] lg:max-w-3xl h-[80vh] p-0 flex flex-col overflow-scroll"
        showCloseButton
      >
        <ModelListView
          models={models}
          currentModel={currentModel}
          onToggle={onToggle}
        />
      </DialogContent>
    </Dialog>
  );
}
