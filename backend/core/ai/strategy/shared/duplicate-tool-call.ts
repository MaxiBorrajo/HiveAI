import { ToolMessage } from "@langchain/core/messages";

export function toolCallKey(name: string, args: unknown): string {
  return `${name}:${JSON.stringify(args ?? {})}`;
}

/** Tool result the model sees instead of re-running an identical call. */
export function duplicateToolCallMessage(
  toolCall: { name: string; id?: string },
): ToolMessage {
  return new ToolMessage({
    tool_call_id: toolCall.id ?? "",
    name: toolCall.name,
    content:
      `This exact call to '${toolCall.name}' with the same arguments already ran successfully earlier in this turn — it was NOT run again, to avoid repeating a real action. If the task is already done, answer the user now instead of calling this again.`,
    status: "error",
  });
}
