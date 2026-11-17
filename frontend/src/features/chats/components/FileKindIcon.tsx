import { cn } from "@/lib/utils";
import type { AttachmentDto } from "../api/attachments";
import { extensionOf, fileKind, KIND_STYLES } from "../lib/fileKind";

/** A colored tile with the file's extension, like a document icon. */
export function FileKindIcon({ attachment, className }: { attachment: AttachmentDto; className?: string }) {
  const kind = fileKind(attachment.originalName, attachment.mimeType);
  const extension = extensionOf(attachment.originalName).slice(0, 4) || "file";
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg font-mono text-[10px] font-semibold uppercase",
        KIND_STYLES[kind],
        className,
      )}
      aria-hidden
    >
      {extension}
    </div>
  );
}
