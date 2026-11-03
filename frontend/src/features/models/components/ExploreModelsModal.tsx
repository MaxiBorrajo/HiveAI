import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ModelDownloadView } from "./ModelDownloadView";

interface ExploreModelsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExploreModelsModal({ isOpen, onOpenChange }: ExploreModelsModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[90vw] max-w-4xl sm:max-w-[90vw] md:max-w-[90vw] lg:max-w-4xl h-[85vh] p-0 flex flex-col"
        showCloseButton
      >
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>Explore models</DialogTitle>
        </DialogHeader>
        <div className="flex flex-1 min-h-0 flex-col px-6 pb-6">
          {isOpen && <ModelDownloadView />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
