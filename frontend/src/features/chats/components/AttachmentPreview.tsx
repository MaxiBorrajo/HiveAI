import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getErrorMessage } from "@/lib/errors";
import {
  attachmentDownloadUrl,
  getAttachmentText,
  type AttachmentDto,
} from "../api/attachments";
import { MessageMarkdown } from "./MessageMarkdown";

const MAX_PREVIEW_ROWS = 200;

const isImage = (a: AttachmentDto) => a.mimeType.startsWith("image/");

/** Text files, documents with extracted text, and images can be previewed. */
export function canPreview(attachment: AttachmentDto): boolean {
  const { mimeType } = attachment;
  return (
    attachment.status === "ready" &&
    (mimeType.startsWith("text/") ||
      mimeType.startsWith("image/") ||
      mimeType === "application/json" ||
      mimeType === "application/pdf" ||
      mimeType === "application/vnd.ms-excel" ||
      mimeType.includes("officedocument"))
  );
}

/** Handles quoted fields with commas, quotes and line breaks inside. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length > 0) rows.push([...row, field]);
  return rows;
}

function CsvTable({ text }: { text: string }) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return null;
  const shown = rows.slice(0, MAX_PREVIEW_ROWS);
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i} className="border border-border bg-muted/50 px-2 py-1 text-left font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i} className="border border-border px-2 py-1">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <p className="text-xs text-muted-foreground">
          Showing {shown.length} of {rows.length} rows.
        </p>
      )}
    </div>
  );
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function PreviewBody({ attachment }: { attachment: AttachmentDto }) {
  const [loaded, setLoaded] = useState<{ text?: string; error?: string }>();

  useEffect(() => {
    if (isImage(attachment)) return;
    let cancelled = false;
    getAttachmentText(attachment.id)
      .then((response) => {
        if (cancelled) return;
        setLoaded(
          response.data
            ? { text: response.data.text }
            : { error: response.errors?.[0] ?? "Could not load the preview." },
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setLoaded({ error: getErrorMessage(error, "Could not load the preview.") });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attachment]);

  if (isImage(attachment)) {
    return (
      <img
        src={attachmentDownloadUrl(attachment.id)}
        alt={attachment.originalName}
        className="max-h-[60vh] w-auto object-contain"
      />
    );
  }
  if (!loaded) return <p className="text-muted-foreground">Loading…</p>;
  if (loaded.error) return <p className="text-destructive">{loaded.error}</p>;

  const text = loaded.text ?? "";
  const { mimeType } = attachment;
  if (mimeType === "text/csv") return <CsvTable text={text} />;
  if (mimeType === "application/json") {
    return <pre className="whitespace-pre-wrap text-xs font-mono">{prettyJson(text)}</pre>;
  }
  if (mimeType === "text/plain") {
    return <pre className="whitespace-pre-wrap text-xs font-mono">{text}</pre>;
  }
  // Markdown, and the text of Word, PowerPoint and PDF files.
  return <MessageMarkdown content={text} />;
}

export function AttachmentPreview({
  attachment,
  onClose,
}: {
  attachment: AttachmentDto | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={attachment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[90vw] max-w-3xl sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{attachment?.originalName}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto text-sm">
          {attachment && <PreviewBody key={attachment.id} attachment={attachment} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
