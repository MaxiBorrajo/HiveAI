import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { PluginsManager } from "../PluginsManager/PluginsManager.tsx";
import { ModesManager } from "../ModesManager/ModesManager.tsx";
import { ModelManager } from "../ModelManager/ModelManager.tsx";
import { useModels } from "@/context/ModelsContext";
import {
  pullEmbeddingModel,
  type PullProgress,
} from "@/lib/models/pullEmbeddingModel";
import { reportError } from "@/lib/toastManager";

interface ChatInputProps {
  input: string;
  setInput: (val: string) => void;
  isThinking: boolean;
  handleSend: () => void;
  isEmpty?: boolean;
}

export function ChatInput({
  input,
  setInput,
  isThinking,
  handleSend,
  isEmpty,
}: ChatInputProps) {
  const {
    hasModel,
    hasAvailableModels,
    embeddingModelStatus,
    openManage,
    refreshModels,
  } = useModels();
  const embeddingModelMissing =
    embeddingModelStatus !== null && !embeddingModelStatus.available;
  const canSend = hasModel && !embeddingModelMissing;

  const [downloadProgress, setDownloadProgress] = useState<PullProgress | null>(
    null,
  );
  const isDownloading = downloadProgress !== null;

  async function handleDownloadEmbeddingModel() {
    setDownloadProgress({ status: "starting" });
    try {
      await pullEmbeddingModel({
        onProgress: setDownloadProgress,
        onDone: () => {
          setDownloadProgress(null);
          refreshModels();
        },
        onError: (message) => {
          setDownloadProgress(null);
          reportError([message]);
        },
      });
    } catch (error) {
      setDownloadProgress(null);
      reportError([
        error instanceof Error
          ? error.message
          : "Failed to download the embedding model.",
      ]);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-2">
      {!hasModel && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <TriangleAlertIcon className="size-4 shrink-0" />
          {hasAvailableModels ? (
            <span>
              No models selected. Choose a respond &amp; verify model and a tool
              selector model to start chatting.
            </span>
          ) : (
            <span>
              No models downloaded. Pull a model with Ollama, then select it
              here.
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto shrink-0"
            onClick={openManage}
          >
            Select models
          </Button>
        </div>
      )}

      {(embeddingModelMissing || isDownloading) && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <div className="flex items-center gap-2">
            {isDownloading ? (
              <Loader2Icon className="size-4 shrink-0 animate-spin" />
            ) : (
              <TriangleAlertIcon className="size-4 shrink-0" />
            )}
            {isDownloading ? (
              <span>
                Downloading embedding model '{embeddingModelStatus?.model}'
                {downloadProgress?.total
                  ? ` — ${Math.round(
                      ((downloadProgress.completed ?? 0) /
                        downloadProgress.total) *
                        100,
                    )}%`
                  : "…"}
              </span>
            ) : (
              <span>
                Embedding model '{embeddingModelStatus?.model}' is not
                installed. Required before sending messages.
              </span>
            )}
            {!isDownloading && (
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto shrink-0"
                onClick={handleDownloadEmbeddingModel}
              >
                Download
              </Button>
            )}
          </div>

          {isDownloading && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-amber-500/20">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{
                  width: downloadProgress?.total
                    ? `${Math.min(
                        100,
                        ((downloadProgress.completed ?? 0) /
                          downloadProgress.total) *
                          100,
                      )}%`
                    : "10%",
                }}
              />
            </div>
          )}
        </div>
      )}

      <div className="relative flex w-full flex-col rounded-xl border border-border bg-card p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message to the agent..."
          className="min-h-14 max-h-52 w-full resize-none overflow-y-auto border-0 bg-transparent py-2 px-3 text-base shadow-none focus-visible:ring-0 placeholder:text-muted-foreground dark:bg-transparent md:text-base"
          rows={2}
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex gap-2">
            <PluginsManager forceOpenDownward={isEmpty} />
            <ModesManager />
            <ModelManager forceOpenDownward={isEmpty} />
          </div>
          <Button
            onClick={handleSend}
            disabled={isThinking || !input.trim() || !canSend}
            title={
              !hasModel
                ? "Select a model before sending a message"
                : embeddingModelMissing
                  ? `Run 'ollama pull ${embeddingModelStatus?.model}' before sending a message`
                  : undefined
            }
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
