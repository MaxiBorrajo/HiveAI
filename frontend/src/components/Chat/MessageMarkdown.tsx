import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";

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
  code: ({ children, className }) =>
    className ? (
      <code className="font-mono text-xs">{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
        {children}
      </code>
    ),
  pre: ({ children }) => (
    <pre className="my-1.5 overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
      {children}
    </pre>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
};

export const MessageMarkdown = memo(function MessageMarkdown({
  content,
}: {
  content: string;
}) {
  return (
    <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
    </div>
  );
});
