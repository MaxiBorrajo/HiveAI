import { Check, Copy, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import type { ExecutionFileArtifact } from "@/features/executions/types";

interface FileArtifactCardProps {
  file: ExecutionFileArtifact;
  onDownload: () => void;
}

export function FileArtifactCard({ file, onDownload }: FileArtifactCardProps) {
  const { copied, copy } = useCopyFeedback();

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-emerald-200">
      <div className="flex items-center gap-3 min-w-0">
        <div className="size-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
          <FileText className="size-4.5 text-emerald-400" />
        </div>
        <div className="min-w-0">
          <h4 className="font-semibold text-xs text-zinc-100 truncate flex items-center gap-1.5">
            {file.name}
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Saved to disk
            </span>
          </h4>
          <p className="text-[11px] text-zinc-400 font-mono truncate" title={file.path}>
            {file.path}
            {file.size ? ` • ${(file.size / 1024).toFixed(1)} KB` : ""}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
        <Button
          size="sm"
          variant="outline"
          onClick={() => copy(file.path)}
          className="h-7 text-xs bg-zinc-900 border-zinc-700/80 hover:bg-zinc-800 text-zinc-300"
        >
          {copied ? (
            <Check className="size-3 text-emerald-400 mr-1" />
          ) : (
            <Copy className="size-3 mr-1" />
          )}
          Copy Path
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onDownload}
          className="h-7 text-xs bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-300"
        >
          <Download className="size-3 mr-1" />
          Download
        </Button>
      </div>
    </div>
  );
}
