import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PluginsManager } from "../PluginsManager/PluginsManager.tsx";

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
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="relative flex w-full max-w-3xl flex-col rounded-xl border border-border bg-card p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
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
        </div>
        <Button onClick={handleSend} disabled={isThinking || !input.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
