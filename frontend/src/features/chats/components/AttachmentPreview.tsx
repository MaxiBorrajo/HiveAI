import { useEffect, useState } from "react";
import { CheckIcon, ChevronLeft, ChevronRight, CopyIcon, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import {
  attachmentDownloadUrl,
  attachmentInlineUrl,
  type AttachmentDto,
} from "../api/attachments";
import { useAttachmentText } from "../hooks/useAttachmentText";
import { codeLanguage, fileKind, formatSize, type FileKind } from "../lib/fileKind";
import { FileKindIcon } from "./FileKindIcon";
import { MessageMarkdown } from "./MessageMarkdown";

const MAX_PREVIEW_ROWS = 200;

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

/** Code with colors, through the same renderer as the chat's code blocks. */
function CodeView({ text, language }: { text: string; language: string }) {
  // A fence longer than any run of backticks inside, so the code cannot close it.
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return <MessageMarkdown content={`${fence}${language}\n${text}\n${fence}`} />;
}

function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="mb-2 flex gap-1 text-xs">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={`rounded-md px-2 py-1 ${
            value === tab.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function TextBody({ attachment, kind, text }: { attachment: AttachmentDto; kind: FileKind; text: string }) {
  const [view, setView] = useState<"rendered" | "source">("rendered");

  if (attachment.mimeType === "text/csv") return <CsvTable text={text} />;
  if (kind === "json") return <CodeView text={prettyJson(text)} language="json" />;
  if (kind === "code") return <CodeView text={text} language={codeLanguage(attachment.originalName)} />;
  if (kind === "text") return <pre className="whitespace-pre-wrap font-mono text-xs">{text}</pre>;
  if (kind === "html") {
    return (
      <>
        <Tabs
          tabs={[{ value: "rendered", label: "Preview" }, { value: "source", label: "Code" }]}
          value={view}
          onChange={setView}
        />
        {view === "rendered" ? (
          <iframe
            title={`${attachment.originalName} preview`}
            srcDoc={text}
            // Scripts run, but in an isolated page with no access to the app.
            sandbox="allow-scripts"
            className="h-[65vh] w-full rounded-md border border-border bg-white"
          />
        ) : (
          <CodeView text={text} language="html" />
        )}
      </>
    );
  }
  // Markdown, and the text of Word, Excel, PowerPoint and PDF files.
  return <MessageMarkdown content={text} />;
}

function PreviewBody({ attachment, text }: { attachment: AttachmentDto; text: ReturnType<typeof useAttachmentText> }) {
  const kind = fileKind(attachment.originalName, attachment.mimeType);
  const [pdfView, setPdfView] = useState<"document" | "text">("document");

  if (kind === "image") {
    return (
      <img
        src={attachmentDownloadUrl(attachment.id)}
        alt={attachment.originalName}
        className="mx-auto max-h-[70vh] w-auto object-contain"
      />
    );
  }

  if (kind === "pdf") {
    return (
      <>
        <Tabs
          tabs={[{ value: "document", label: "Document" }, { value: "text", label: "Text" }]}
          value={pdfView}
          onChange={setPdfView}
        />
        {pdfView === "document" ? (
          <iframe
            title={`${attachment.originalName} document`}
            src={attachmentInlineUrl(attachment.id)}
            className="h-[68vh] w-full rounded-md border border-border"
          />
        ) : (
          <TextOrStatus attachment={attachment} kind={kind} text={text} />
        )}
      </>
    );
  }

  return <TextOrStatus attachment={attachment} kind={kind} text={text} />;
}

function TextOrStatus({
  attachment,
  kind,
  text,
}: {
  attachment: AttachmentDto;
  kind: FileKind;
  text: ReturnType<typeof useAttachmentText>;
}) {
  if (!text) return <p className="text-muted-foreground">Loading…</p>;
  if ("error" in text) return <p className="text-destructive">{text.error}</p>;
  return <TextBody attachment={attachment} kind={kind} text={text.text} />;
}

/**
 * A file opened large. With several files, arrows (or ← →) move between them.
 */
export function AttachmentPreview({
  attachments,
  index,
  onIndexChange,
  onClose,
}: {
  attachments: AttachmentDto[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const attachment = index === null ? null : (attachments[index] ?? null);
  const isImage = attachment?.mimeType.startsWith("image/") ?? false;
  const text = useAttachmentText(attachment, !!attachment && !isImage);
  const { copied, copy } = useCopyFeedback();
  const count = attachments.length;

  const go = (step: number) => {
    if (index === null || count < 2) return;
    onIndexChange((index + step + count) % count);
  };

  useEffect(() => {
    if (index === null || count < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") onIndexChange((index + 1) % count);
      if (event.key === "ArrowLeft") onIndexChange((index - 1 + count) % count);
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [index, count, onIndexChange]);

  const iconButton = "rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground";

  return (
    <Dialog open={attachment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[88vh] w-[94vw] max-w-5xl flex-col sm:max-w-5xl">
        {attachment && (
          <>
            <DialogHeader className="flex-row items-center gap-3 pr-8">
              <FileKindIcon attachment={attachment} />
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate">{attachment.originalName}</DialogTitle>
                <DialogDescription className="text-xs">
                  {formatSize(attachment.sizeBytes)}
                  {count > 1 && ` · ${index! + 1} of ${count}`}
                </DialogDescription>
              </div>
              <div className="flex items-center gap-0.5">
                {count > 1 && (
                  <>
                    <button type="button" className={iconButton} onClick={() => go(-1)} title="Previous file">
                      <ChevronLeft className="size-4" />
                    </button>
                    <button type="button" className={iconButton} onClick={() => go(1)} title="Next file">
                      <ChevronRight className="size-4" />
                    </button>
                  </>
                )}
                {text && "text" in text && (
                  <button
                    type="button"
                    className={iconButton}
                    onClick={() => copy(text.text)}
                    title={copied ? "Copied" : "Copy text"}
                  >
                    {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                  </button>
                )}
                <a href={attachmentDownloadUrl(attachment.id)} className={iconButton} title="Download">
                  <Download className="size-4" />
                </a>
              </div>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-auto text-sm">
              <PreviewBody key={attachment.id} attachment={attachment} text={text} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
