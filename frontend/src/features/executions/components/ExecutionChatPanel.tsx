import { ChatInput } from "../../chats/components/ChatInput";
import { cn } from "../../../lib/utils";
import type { GraphEdge, GraphNode } from "../types";

interface ExecutionChatPanelProps {
  input: string;
  setInput: (value: string) => void;
  isThinking: boolean;
  isEmpty: boolean;
  isEditing: boolean;
  selectedNode?: GraphNode;
  selectedEdge?: GraphEdge;
  onSend: () => void;
  onStop: () => void;
  onClearSelection: () => void;
}

export function ExecutionChatPanel({
  input,
  setInput,
  isThinking,
  isEmpty,
  isEditing,
  selectedNode,
  selectedEdge,
  onSend,
  onStop,
  onClearSelection,
}: ExecutionChatPanelProps) {
  const placeholder =
    isEditing && selectedNode
      ? `Specify how you want to modify "${selectedNode.name}"...`
      : isEditing
        ? "Ask the AI to change the graph, or select a node to change just that one..."
        : "I want a flow that researches a topic and generates a report...";

  return (
    <div className={cn("w-full px-6 pt-12 pb-8", isEditing && "pr-66")}>
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 pointer-events-auto">
        {isEditing && (selectedNode || selectedEdge) && (
          <div className="flex items-center gap-2 px-3 py-1 bg-primary/20 border border-primary/40 rounded-full text-xs text-primary shadow">
            <span>
              Editing {selectedNode ? "node" : "edge"}: <strong>{selectedNode ? selectedNode.name : selectedEdge?.id}</strong>
              {selectedNode ? ` (${selectedNode.type})` : ""}
            </span>
            <button onClick={onClearSelection} className="hover:text-foreground ml-1 font-bold">
              ✕
            </button>
          </div>
        )}
        <ChatInput
          input={input}
          setInput={setInput}
          isThinking={isThinking}
          handleSend={onSend}
          handleStop={onStop}
          isEmpty={isEmpty && !isEditing}
          hidePluginsAndModes
          placeholder={placeholder}
        />
        <p className="text-center text-xs text-muted-foreground mt-2">
          HiveAI can make mistakes. Consider verifying important information.
        </p>
      </div>
    </div>
  );
}
