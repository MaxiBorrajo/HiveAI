import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { LangGraphAbstraction } from "@/features/executions/types";

export interface RunExecutionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  graph: LangGraphAbstraction | null;
  hasRequiredInputs: boolean;
  runInputs: Record<string, any>;
  setRunInputs: (updater: (prev: Record<string, any>) => Record<string, any>) => void;
  onRun: () => void;
}

/**
 * The "Start Execution" input-collection dialog, extracted out of
 * ExecutionsMain (which used to build this Dialog/DialogContent/DialogFooter
 * tree inline, unlike RenameDialog/DeleteConfirmationDialog which already
 * live as their own reusable components).
 */
export function RunExecutionModal({
  open,
  onOpenChange,
  graph,
  hasRequiredInputs,
  runInputs,
  setRunInputs,
  onRun,
}: RunExecutionModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start Execution</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          {graph?.stateSchema &&
            Object.entries(graph.stateSchema)
              .filter(([key]) => key === "input")
              .map(([key, def]: [string, any]) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">
                    {def.description && !def.description.startsWith("User initial query")
                      ? def.description
                      : "User Input"}{" "}
                    {hasRequiredInputs ? "" : "(Optional)"}
                  </label>
                  <Textarea
                    placeholder={
                      def.description || "Enter input text or prompt to run this workflow..."
                    }
                    value={runInputs[key] || ""}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setRunInputs((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                    className="min-h-[110px]"
                  />
                  <p className="text-xs text-muted-foreground">
                    {hasRequiredInputs
                      ? "This workflow requires an input value to execute."
                      : "Optional input. If omitted, the workflow will run with its pre-configured defaults."}
                  </p>
                </div>
              ))}
          {graph?.stateSchema && !graph.stateSchema["input"] && (
            <p className="text-sm text-yellow-600">
              Warning: The graph does not have a standard 'input' property
              defined in its state schema.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={hasRequiredInputs && !runInputs["input"]?.trim()}
            onClick={onRun}
          >
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
