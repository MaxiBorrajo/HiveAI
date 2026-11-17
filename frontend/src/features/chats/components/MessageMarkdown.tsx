import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import { normalizeMathDelimiters, openFenceOffset } from "../lib/markdown";
import { CodeBlock } from "./markdown/CodeBlock";
import { MarkdownImage, MarkdownLink } from "./markdown/MarkdownMedia";
import { OpenBlockContext } from "./markdown/streamingContext";

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-3 mb-1.5 text-lg font-semibold">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-1.5 text-base font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2 mb-1 text-sm font-semibold">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-2 mb-1 text-sm font-semibold">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-2 mb-1 text-sm font-semibold">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="mt-2 mb-1 text-sm font-semibold">{children}</h6>
  ),
  p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  // A block's text ends in a newline; inline code never has one.
  code: ({ children, className }) =>
    className || String(children).includes("\n") ? (
      <code className={`font-mono text-xs ${className ?? ""}`}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
        {children}
      </code>
    ),
  pre: CodeBlock,
  img: ({ src, alt }) => (
    <MarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} />
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 align-top">{children}</td>
  ),
  a: ({ children, href }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
};

export const MessageMarkdown = memo(function MessageMarkdown({
  content,
}: {
  content: string;
}) {
  const text = normalizeMathDelimiters(content);
  return (
    <OpenBlockContext.Provider value={openFenceOffset(text)}>
      <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <ReactMarkdown
          // A single $ stays text, so prices are not read as math; math is $$…$$.
          remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
          rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false }]]}
          components={markdownComponents}
        >
          {text}
        </ReactMarkdown>
      </div>
    </OpenBlockContext.Provider>
  );
});
