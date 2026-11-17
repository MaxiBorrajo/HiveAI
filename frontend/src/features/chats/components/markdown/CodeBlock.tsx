import { useContext, useEffect, useState, type ReactNode } from "react";
import type { ExtraProps } from "react-markdown";
import { useTheme } from "next-themes";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import { renderMermaid } from "../../lib/renderMermaid";
import { OpenBlockContext } from "./streamingContext";

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

function textOf(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

function languageOf(code: HastNode | undefined): string {
  const classes = code?.properties?.className;
  const language = Array.isArray(classes)
    ? classes.find((c): c is string => typeof c === "string" && c.startsWith("language-"))
    : undefined;
  return language?.slice("language-".length).toLowerCase() ?? "";
}

const SVG_START = /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i;

/** Models often label a drawing as xml or html, or not at all: what counts is that it is an <svg>. */
function isSvg(language: string, source: string): boolean {
  return language === "svg" || (["xml", "html", ""].includes(language) && SVG_START.test(source));
}

/** A fenced code block: highlighted code with a copy button, or a drawing for svg and mermaid. */
export function CodeBlock({ node, children }: { children?: ReactNode } & ExtraProps) {
  const openBlockAt = useContext(OpenBlockContext);
  const code = (node?.children ?? []).find((c) => c.type === "element") as HastNode | undefined;
  const language = languageOf(code);
  const source = textOf(code).replace(/\n$/, "");
  const start = node?.position?.start.offset ?? -1;
  const stillWriting = openBlockAt !== null && start >= openBlockAt;

  const preview = stillWriting
    ? null
    : isSvg(language, source)
      ? <SvgPreview svg={source} />
      : language === "mermaid"
        ? <MermaidPreview code={source} />
        : null;

  return (
    <BlockFrame language={language} source={source} preview={preview}>
      <pre className="overflow-x-auto p-2 font-mono text-xs">{children}</pre>
    </BlockFrame>
  );
}

function BlockFrame({
  language,
  source,
  preview,
  children,
}: {
  language: string;
  source: string;
  preview: ReactNode;
  children: ReactNode;
}) {
  const [showCode, setShowCode] = useState(false);
  const { copied, copy } = useCopyFeedback();
  const tab = (active: boolean) =>
    `rounded px-1.5 py-0.5 ${active ? "bg-background text-foreground" : "hover:text-foreground"}`;

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border/60 bg-muted">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2 py-1 text-[11px] text-muted-foreground">
        <span className="font-mono">{language || "text"}</span>
        <div className="flex items-center gap-1">
          {preview && (
            <>
              <button type="button" className={tab(!showCode)} onClick={() => setShowCode(false)}>
                Preview
              </button>
              <button type="button" className={tab(showCode)} onClick={() => setShowCode(true)}>
                Code
              </button>
            </>
          )}
          <button
            type="button"
            className="ml-1 flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground"
            onClick={() => copy(source)}
            title={copied ? "Copied" : "Copy code"}
            aria-label={copied ? "Copied" : "Copy code"}
          >
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          </button>
        </div>
      </div>
      {preview && !showCode ? preview : children}
    </div>
  );
}

/** Shown as an image, so a script inside the drawing cannot run. */
function SvgPreview({ svg }: { svg: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <p className="p-2 text-xs text-muted-foreground">This drawing could not be displayed; see the code.</p>;
  }
  return (
    <div className="flex justify-center bg-white p-3">
      <img
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
        alt="SVG drawing"
        className="max-h-120 max-w-full"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function MermaidPreview({ code }: { code: string }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  const [result, setResult] = useState<{ svg: string } | { error: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    renderMermaid(code, dark)
      .then((svg) => !cancelled && setResult({ svg }))
      .catch((error) =>
        !cancelled && setResult({ error: error instanceof Error ? error.message : String(error) })
      );
    return () => {
      cancelled = true;
    };
  }, [code, dark]);

  if (!result) return <p className="p-2 text-xs text-muted-foreground">Drawing the diagram…</p>;
  if ("error" in result) {
    return (
      <p className="p-2 text-xs text-muted-foreground">
        This diagram has an error, see the code: <span className="font-mono">{result.error}</span>
      </p>
    );
  }
  return (
    <div
      className="flex justify-center overflow-x-auto p-3 [&_svg]:h-auto [&_svg]:max-w-full"
      // Sanitized by Mermaid's strict mode (see renderMermaid).
      dangerouslySetInnerHTML={{ __html: result.svg }}
    />
  );
}
