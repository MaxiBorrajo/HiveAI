import { useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  attachmentDownloadUrl,
  type AttachmentDto,
} from "../api/attachments";
import { useAttachmentText } from "../hooks/useAttachmentText";
import { fileKind, formatSize } from "../lib/fileKind";
import { AttachmentPreview, canPreview } from "./AttachmentPreview";
import { FileKindIcon } from "./FileKindIcon";

interface AttachmentsListProps {
  attachments: AttachmentDto[];
  onRemove?: (id: number) => void;
  removing?: number[];
  className?: string;
}

/** Lines of a generated file shown on its card, so it can be read without opening it. */
const SNIPPET_LINES = 6;
/** Kinds whose text says something at a glance; a spreadsheet or deck reads badly as text. */
const SNIPPET_KINDS = new Set(["markdown", "json", "html", "code", "text", "word", "pdf"]);

function scanLabel({ scan, mimeType }: AttachmentDto): string | null {
  // An image's text only matters to models that cannot see it.
  if (mimeType.startsWith("image/")) {
    return scan?.status === "pending" ? "Reading its text" : null;
  }
  if (scan?.status === "pending") return `Reading images ${scan.done}/${scan.total}`;
  if (scan?.status === "failed") return "Images could not be read";
  return null;
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

function typeLabel(attachment: AttachmentDto): string {
  const kind = fileKind(attachment.originalName, attachment.mimeType);
  const names: Record<string, string> = {
    pdf: "PDF",
    word: "Word document",
    sheet: "Spreadsheet",
    slides: "Presentation",
    markdown: "Markdown",
    json: "JSON",
    html: "Web page",
    code: "Code",
    text: "Text",
  };
  return names[kind] ?? "File";
}

function RemoveButton({ onClick, disabled, className }: { onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Remove"
      aria-label="Remove"
      className={cn(
        "flex size-5 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border hover:text-foreground disabled:opacity-50",
        className,
      )}
    >
      <X className="size-3" />
    </button>
  );
}

function ImageTile({
  attachment,
  onOpen,
  onRemove,
  removing,
}: {
  attachment: AttachmentDto;
  onOpen?: () => void;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const scanning = scanLabel(attachment);
  const image = (
    <img
      src={attachmentDownloadUrl(attachment.id)}
      alt={attachment.originalName}
      loading="lazy"
      className="size-full object-cover"
    />
  );
  return (
    <div className={cn("group/file relative size-20 shrink-0", removing && "opacity-50")}>
      <div className="size-full overflow-hidden rounded-lg border border-border bg-muted/40">
        {onOpen ? (
          <button type="button" onClick={onOpen} title="Preview" className="size-full cursor-zoom-in">
            {image}
          </button>
        ) : (
          image
        )}
      </div>
      {scanning && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 rounded-b-lg bg-background/85 px-1 py-0.5 text-[9px] text-muted-foreground">
          <Loader2 className="size-2.5 animate-spin" /> {scanning}
        </div>
      )}
      {onRemove && <RemoveButton onClick={onRemove} disabled={removing} className="absolute -right-1.5 -top-1.5" />}
    </div>
  );
}

function Snippet({ attachment }: { attachment: AttachmentDto }) {
  const text = useAttachmentText(attachment);
  if (!text || !("text" in text) || !text.text.trim()) return null;
  const lines = text.text.trim().split("\n");
  return (
    <pre className="mt-2 max-h-28 overflow-hidden whitespace-pre-wrap border-t border-border/60 pt-2 font-mono text-[10px] leading-snug text-muted-foreground [mask-image:linear-gradient(to_bottom,black_60%,transparent)]">
      {lines.slice(0, SNIPPET_LINES).join("\n")}
    </pre>
  );
}

function FileCard({
  attachment,
  onOpen,
  onRemove,
  removing,
}: {
  attachment: AttachmentDto;
  onOpen?: () => void;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const problem = statusLabel(attachment.status);
  const kind = fileKind(attachment.originalName, attachment.mimeType);
  const showSnippet = !problem && !onRemove && attachment.direction === "output" && SNIPPET_KINDS.has(kind);
  const detail = problem ?? scanLabel(attachment) ?? `${typeLabel(attachment)} · ${formatSize(attachment.sizeBytes)}`;

  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <FileKindIcon attachment={attachment} />
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-xs font-medium" title={attachment.originalName}>
            {attachment.originalName}
          </p>
          <p className={cn("text-[10px]", problem ? "text-destructive" : "text-muted-foreground")}>{detail}</p>
        </div>
      </div>
      {showSnippet && <Snippet attachment={attachment} />}
    </>
  );

  return (
    <div
      className={cn(
        "group/file relative rounded-xl border text-foreground transition-colors",
        showSnippet ? "w-72" : "w-60",
        problem ? "border-destructive/30 bg-destructive/10" : "border-border bg-card hover:border-foreground/20",
        removing && "opacity-50",
      )}
    >
      {onOpen ? (
        <button type="button" onClick={onOpen} title="Preview" className="block w-full p-2.5 text-left">
          {body}
        </button>
      ) : (
        <div className="p-2.5">{body}</div>
      )}
      {!problem && !onRemove && (
        <a
          href={attachmentDownloadUrl(attachment.id)}
          title="Download"
          aria-label={`Download ${attachment.originalName}`}
          className="absolute right-2 top-2 rounded-md bg-card p-1 text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/file:opacity-100"
        >
          <Download className="size-3.5" />
        </a>
      )}
      {onRemove && <RemoveButton onClick={onRemove} disabled={removing} className="absolute -right-1.5 -top-1.5" />}
    </div>
  );
}

/**
 * Files of a message or of the message being written: images as thumbnails,
 * other files as cards. Generated files show their first lines. A click opens
 * the file large, with arrows to the others.
 */
export function AttachmentsList({
  attachments,
  onRemove,
  removing,
  className,
}: AttachmentsListProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  if (attachments.length === 0) return null;

  // Files are not previewed while they are still being attached.
  const previewable = onRemove ? [] : attachments.filter(canPreview);
  const images = attachments.filter((a) => a.mimeType.startsWith("image/") && !statusLabel(a.status));
  const files = attachments.filter((a) => !images.includes(a));
  const opener = (attachment: AttachmentDto) => {
    const index = previewable.indexOf(attachment);
    return index === -1 ? undefined : () => setPreviewIndex(index);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((attachment) => (
            <ImageTile
              key={attachment.id}
              attachment={attachment}
              onOpen={opener(attachment)}
              onRemove={onRemove && (() => onRemove(attachment.id))}
              removing={removing?.includes(attachment.id)}
            />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((attachment) => (
            <FileCard
              key={attachment.id}
              attachment={attachment}
              onOpen={opener(attachment)}
              onRemove={onRemove && (() => onRemove(attachment.id))}
              removing={removing?.includes(attachment.id)}
            />
          ))}
        </div>
      )}
      <AttachmentPreview
        attachments={previewable}
        index={previewIndex}
        onIndexChange={setPreviewIndex}
        onClose={() => setPreviewIndex(null)}
      />
    </div>
  );
}
