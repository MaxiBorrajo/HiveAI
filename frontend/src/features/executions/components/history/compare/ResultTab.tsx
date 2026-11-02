import { downloadFile, stringifyContent } from "@/lib/download";
import { FileArtifactCard } from "../../result/FileArtifactCard";
import { ResultRenderer } from "../../result/ResultRenderer";
import { normalizeResult } from "../../../lib/executionResult";
import type { ExecutionFileArtifact, RunSummary } from "../../../types";
import { RunColumns, runLabel } from "./shared";

function ResultColumn({ run }: { run: RunSummary }) {
  const result = normalizeResult(run.result);
  const download = (file: ExecutionFileArtifact) =>
    downloadFile(file.name, stringifyContent(result.content));
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="font-mono text-xs font-medium">{runLabel(run)}</div>
      {result.files && result.files.length > 0 && (
        <div className="flex flex-col gap-2">
          {result.files.map((file, i) => (
            <FileArtifactCard
              key={i}
              file={file}
              onDownload={() => download(file)}
            />
          ))}
        </div>
      )}
      <div className="max-h-[60vh] overflow-auto">
        <ResultRenderer result={result} />
      </div>
    </div>
  );
}

export function ResultTab({ runs }: { runs: RunSummary[] }) {
  return (
    <RunColumns count={runs.length}>
      {runs.map((run) => (
        <div key={run.historyId} className="min-w-0">
          <ResultColumn run={run} />
        </div>
      ))}
    </RunColumns>
  );
}
