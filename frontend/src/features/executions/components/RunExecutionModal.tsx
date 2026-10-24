import { useRef, useState } from "react";
import { Loader2Icon, PaperclipIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentsList } from "@/features/chats/components/AttachmentsList";
import {
  ACCEPTED_ATTACHMENT_TYPES,
  uploadExecutionAttachment,
  type AttachmentDto,
} from "@/features/chats/api/attachments";
import { reportError } from "@/lib/toastManager";
import { getErrorMessage } from "@/lib/errors";
import type { LangGraphAbstraction } from "@/features/executions/types";

export interface RunExecutionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  executionId: string | null;
  graph: LangGraphAbstraction | null;
  hasRequiredInputs: boolean;
  runInputs: Record<string, any>;
  setRunInputs: (updater: (prev: Record<string, any>) => Record<string, any>) => void;
  runAttachments: AttachmentDto[];
  setRunAttachments: (attachments: AttachmentDto[]) => void;
  onRun: () => void;
}

export function RunExecutionModal({
  open,
  onOpenChange,
  executionId,
  graph,
  hasRequiredInputs,
  runInputs,
  setRunInputs,
  runAttachments,
  setRunAttachments,
  onRun,
}: RunExecutionModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !executionId) return;
    const files = Array.from(fileList);
    setIsUploading(true);
    try {
      for (const file of files) {
        try {
          const response = await uploadExecutionAttachment(
            Number(executionId),
            file,
          );
          if (response.data) {
            setRunAttachments([...runAttachments, response.data]);
          }
        } catch (error) {
          reportError([
            getErrorMessage(error, `Could not upload '${file.name}'.`),
          ]);
        }
      }
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Start Execution</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto py-2">
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
                    className="min-h-[140px] max-h-[45vh] overflow-y-auto"
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

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">
              Files (Optional)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_ATTACHMENT_TYPES}
              className="hidden"
              onChange={(event) => {
                handleFilesSelected(event.target.files);
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit gap-1.5 text-xs"
              disabled={isUploading || !executionId}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <PaperclipIcon className="size-3.5" />
              )}
              Attach files
            </Button>
            {runAttachments.length > 0 && (
              <AttachmentsList
                attachments={runAttachments}
                onRemove={(id) =>
                  setRunAttachments(runAttachments.filter((a) => a.id !== id))
                }
              />
            )}
            <p className="text-xs text-muted-foreground">
              Files given to the workflow as input, available while it runs.
            </p>
          </div>
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
