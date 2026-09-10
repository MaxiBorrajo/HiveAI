import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { HiveMicrokernel } from "../../../microkernel/hive-microkernel.ts";
import { embedText } from "../../../memory/embeddings.ts";
import { hybridSearchGlobal } from "../../../memory/messageStore.ts";

const RECALL_TOOL_NAME = "recall_past_conversations";

const RecallSchema = z.object({
  query: z.string().describe("What to search for in past conversations"),
  limit: z.number().int().min(1).max(20).default(5).optional(),
});

type NativeTool = DynamicStructuredTool<
  z.ZodType,
  Record<string, unknown>,
  Record<string, unknown>,
  string,
  unknown,
  string
>;

function buildRecallTool(chatId: string): NativeTool {
  return tool(
    async ({ query, limit }: z.infer<typeof RecallSchema>) => {
      const dataDir = HiveMicrokernel.getInstance().getConfig().get("dataDir");
      const vector = await embedText(query);
      const results = await hybridSearchGlobal(
        dataDir,
        query,
        vector,
        limit ?? 5,
        chatId,
      );

      if (results.length === 0) {
        return "No relevant information found in past conversations.";
      }

      return results
        .map(
          (r) =>
            `[${new Date(r.timestamp).toISOString()}] (${r.role}): ${r.content}`,
        )
        .join("\n---\n");
    },
    {
      name: RECALL_TOOL_NAME,
      description:
        "Search across ALL previous chat conversations (not just the current one) for relevant information the user has mentioned before — facts, preferences, past decisions, or context from earlier sessions. Use this when the user references something that isn't in the current conversation, or asks you to remember something from before.",
      schema: RecallSchema,
    },
  );
}

export function buildNativeTools(chatId: string): NativeTool[] {
  return [buildRecallTool(chatId)];
}

export function getNativeTool(
  name: string,
  chatId: string,
): NativeTool | undefined {
  return buildNativeTools(chatId).find((t) => t.name === name);
}
