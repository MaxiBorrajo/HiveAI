import { AlertTriangle, ExternalLink } from "lucide-react";
import { MessageMarkdown } from "@/features/chats/components/MessageMarkdown";
import { stringifyContent } from "@/lib/download";
import type { ExecutionResult } from "@/features/executions/types";

function TableResult({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/60 shadow-lg">
      <div className="overflow-x-auto max-h-[460px]">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-zinc-900/90 text-zinc-300 sticky top-0 border-b border-zinc-800 font-mono text-[11px]">
            <tr>
              {Object.keys(rows[0]).map((header) => (
                <th key={header} className="p-2.5 font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 font-mono text-zinc-300">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-zinc-900/50 transition-colors">
                {Object.values(row).map((val, j) => (
                  <td key={j} className="p-2.5 whitespace-nowrap">
                    {typeof val === "object" ? JSON.stringify(val) : String(val ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TerminalResult({ result }: { result: ExecutionResult }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-black/90 overflow-hidden shadow-2xl">
      <div className="px-3 py-2 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-rose-500/80" />
          <span className="size-2.5 rounded-full bg-amber-500/80" />
          <span className="size-2.5 rounded-full bg-emerald-500/80" />
          <span className="text-[10px] font-mono text-zinc-400 ml-2">
            {result.metadata?.command || "bash session"}
          </span>
        </div>
        <span className="text-[10px] font-mono text-emerald-400">stdout</span>
      </div>
      <pre className="p-4 text-xs font-mono text-emerald-400/90 whitespace-pre-wrap break-all overflow-x-auto leading-relaxed max-h-[460px]">
        {stringifyContent(result.content)}
      </pre>
    </div>
  );
}

function ErrorResult({ result }: { result: ExecutionResult }) {
  return (
    <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-950/20 text-rose-300 space-y-2">
      <div className="flex items-center gap-2 font-semibold text-xs">
        <AlertTriangle className="size-4 text-rose-400 shrink-0" />
        <span>{result.summary}</span>
      </div>
      <pre className="text-xs font-mono bg-black/40 p-2.5 rounded-lg border border-rose-900/50 overflow-x-auto whitespace-pre-wrap break-all text-rose-200">
        {stringifyContent(result.content)}
      </pre>
    </div>
  );
}

export function ResultRenderer({ result }: { result: ExecutionResult }) {
  const { type, content } = result;

  if (type === "file" || type === "markdown") {
    return (
      <div className="text-sm text-zinc-200 leading-relaxed max-w-none pt-1">
        <MessageMarkdown content={stringifyContent(content)} />
      </div>
    );
  }

  if (type === "boolean") {
    return (
      <div className="flex flex-col gap-1.5 p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40">
        <h4 className="text-sm font-semibold text-zinc-100">
          Decision: {content ? "TRUE" : "FALSE"}
        </h4>
        <p className="text-xs text-zinc-400">{result.summary}</p>
      </div>
    );
  }

  if (
    type === "table" &&
    Array.isArray(content) &&
    content.length > 0 &&
    typeof content[0] === "object"
  ) {
    return <TableResult rows={content} />;
  }

  if (type === "terminal") return <TerminalResult result={result} />;

  if (type === "json") {
    return (
      <pre className="text-xs font-mono text-zinc-300 bg-zinc-900/40 p-4 rounded-xl overflow-x-auto whitespace-pre-wrap break-all border border-zinc-800/80">
        {JSON.stringify(content, null, 2)}
      </pre>
    );
  }

  if (type === "image") {
    return (
      <div className="p-2 rounded-xl border border-zinc-800 bg-zinc-900/40 flex justify-center">
        <img
          src={String(content)}
          alt="Execution Output"
          className="rounded-lg max-h-[500px] object-contain shadow-md"
        />
      </div>
    );
  }

  if (type === "url") {
    return (
      <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40 space-y-2">
        <h4 className="text-xs font-semibold text-zinc-200">{result.summary}</h4>
        <a
          href={String(content)}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-mono text-emerald-400 hover:underline flex items-center gap-1.5 break-all"
        >
          <ExternalLink className="size-3.5 shrink-0" />
          {String(content)}
        </a>
      </div>
    );
  }

  if (type === "error") return <ErrorResult result={result} />;

  return (
    <div className="text-sm text-zinc-200 leading-relaxed font-sans p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40">
      {String(content ?? "Execution completed with no return value.")}
    </div>
  );
}
