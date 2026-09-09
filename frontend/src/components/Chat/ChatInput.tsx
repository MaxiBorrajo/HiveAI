import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TriangleAlertIcon } from "lucide-react";
import { PluginsManager } from "../PluginsManager/PluginsManager.tsx";
import { ModesManager } from "../ModesManager/ModesManager.tsx";
import { ModelManager } from "../ModelManager/ModelManager.tsx";
import { useModels } from "@/context/ModelsContext";

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
  const { hasModel, hasAvailableModels, openManage } = useModels();

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
              No models selected. Choose a respond &amp; verify model and a
              tool selector model to start chatting.
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

      <div className="relative flex w-full flex-col rounded-xl border border-border bg-card p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message to the agent..."
          className="min-h-14 w-full resize-none border-0 bg-transparent py-2 px-3 text-base shadow-none focus-visible:ring-0 placeholder:text-muted-foreground dark:bg-transparent md:text-base"
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
            disabled={isThinking || !input.trim() || !hasModel}
            title={
              hasModel ? undefined : "Select a model before sending a message"
            }
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
