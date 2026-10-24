import { Download, FileText, Image as ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  attachmentDownloadUrl,
  type AttachmentDto,
} from "../api/attachments";

interface AttachmentsListProps {
  attachments: AttachmentDto[];
  onRemove?: (id: number) => void;
  removing?: number[];
  className?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: AttachmentDto["status"]): string | null {
  switch (status) {
    case "rejected_size":
      return "Too large";
    case "rejected_type":
      return "Unsupported type";
    case "context_overflow":
      return "Skipped (context limit)";
    default:
      return null;
  }
}

export function AttachmentsList({
  attachments,
  onRemove,
  removing,
  className,
}: AttachmentsListProps) {
  if (attachments.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {attachments.map((attachment) => {
        const isImage = attachment.mimeType.startsWith("image/");
        const problem = statusLabel(attachment.status);
        const isRemoving = removing?.includes(attachment.id);

        return (
          <div
            key={attachment.id}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
              problem
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-border bg-muted/40 text-foreground",
              isRemoving && "opacity-50",
            )}
          >
            <div className="size-6 rounded-md bg-background/60 border border-border/60 flex items-center justify-center shrink-0">
              {isImage ? (
                <ImageIcon className="size-3.5 text-muted-foreground" />
              ) : (
                <FileText className="size-3.5 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 max-w-[180px]">
              <p className="truncate font-medium" title={attachment.originalName}>
                {attachment.originalName}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {problem ?? formatSize(attachment.sizeBytes)}
              </p>
            </div>

            {!problem && !onRemove && (
              <a
                href={attachmentDownloadUrl(attachment.id)}
                target="_blank"
                rel="noreferrer"
                title="Download"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Download className="size-3.5" />
              </a>
            )}

            {onRemove && (
              <Button
                variant="ghost"
                size="icon"
                className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
                disabled={isRemoving}
                onClick={() => onRemove(attachment.id)}
                title="Remove"
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
