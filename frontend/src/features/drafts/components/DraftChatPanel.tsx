import { ChatInput } from "@/features/chats/components/ChatInput";
import { cn } from "@/lib/utils";
import { DraftChatActivityFeed } from "./DraftChatActivityFeed";
import type { ActivityEntry } from "../lib/draftChatActivity";

interface DraftChatPanelProps {
  input: string;
  setInput: (value: string) => void;
  isThinking: boolean;
  isEmpty: boolean;
  activity: ActivityEntry[];
  onSend: () => void;
  onStop: () => void;
}

export function DraftChatPanel({
  input,
  setInput,
  isThinking,
  isEmpty,
  activity,
  onSend,
  onStop,
}: DraftChatPanelProps) {
  return (
    <div className={cn("w-full px-4 pt-6 pb-4")}>
      <div className="mx-auto flex max-w-xl flex-col items-center gap-2 pointer-events-auto">
        <DraftChatActivityFeed entries={activity} isActive={isThinking} />
        <ChatInput
          input={input}
          setInput={setInput}
          isThinking={isThinking}
          handleSend={onSend}
          handleStop={onStop}
          isEmpty={isEmpty}
          hidePluginsAndModes
          placeholder="I want a plugin that sends a message to a Slack webhook..."
        />
        <p className="text-center text-xs text-muted-foreground mt-2">
          HiveAI can make mistakes. Review the generated code before importing.
        </p>
      </div>
    </div>
  );
}
