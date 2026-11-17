import { useState, type ReactNode } from "react";
import { ImageOffIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { mediaKind } from "../../lib/markdown";

function Player({ kind, src, title }: { kind: "video" | "audio"; src: string; title?: string }) {
  return kind === "video" ? (
    <video controls preload="metadata" src={src} title={title} className="my-2 block max-h-[420px] max-w-full rounded-md" />
  ) : (
    <audio controls preload="metadata" src={src} title={title} className="my-2 block w-full max-w-md" />
  );
}

/** `![alt](url)`: an image that fits the message and opens larger, or a player for video and audio. */
export function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  if (!src) return null;

  const kind = mediaKind(src);
  if (kind) return <Player kind={kind} src={src} title={alt} />;

  if (failed) {
    return (
      <span className="my-1 inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
        <ImageOffIcon className="size-3.5" />
        {alt ? `Image "${alt}" could not be loaded` : "The image could not be loaded"}
      </span>
    );
  }

  return (
    <>
      <button type="button" className="my-2 block cursor-zoom-in" onClick={() => setOpen(true)} title="Open larger">
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          className="max-h-[360px] max-w-full rounded-md border border-border/60"
          onError={() => setFailed(true)}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[92vw] max-w-5xl sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{alt || "Image"}</DialogTitle>
          </DialogHeader>
          <img src={src} alt={alt ?? ""} className="mx-auto max-h-[78vh] max-w-full object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A link to a video or audio file plays in place; any other link opens outside. */
export function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const kind = mediaKind(href);
  const link = (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  );
  if (!kind || !href) return link;
  return (
    <>
      <Player kind={kind} src={href} />
      {/* A bare URL needs no caption; a named link keeps its name. */}
      {String(children) !== href && link}
    </>
  );
}
