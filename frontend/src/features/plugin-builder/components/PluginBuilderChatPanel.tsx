import { ChatInput } from "../../chats/components/ChatInput";
import { cn } from "../../../lib/utils";
import { PluginBuilderActivityFeed } from "./PluginBuilderActivityFeed";
import type { ActivityEntry } from "../lib/pluginBuilderActivity";

interface PluginBuilderChatPanelProps {
  input: string;
  setInput: (value: string) => void;
  isThinking: boolean;
  isEmpty: boolean;
  activity: ActivityEntry[];
  onSend: () => void;
  onStop: () => void;
}

export function PluginBuilderChatPanel({
  input,
  setInput,
  isThinking,
  isEmpty,
  activity,
  onSend,
  onStop,
}: PluginBuilderChatPanelProps) {
  return (
    <div className={cn("w-full px-6 pt-12 pb-8")}>
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 pointer-events-auto">
        <PluginBuilderActivityFeed entries={activity} isActive={isThinking} />
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
          HiveAI can make mistakes. Review the generated code and tests before installing.
        </p>
      </div>
    </div>
  );
}
