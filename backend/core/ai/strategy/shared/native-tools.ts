import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getORM } from "../../../../infrastructure/db/orm.ts";
import { MessageRepository } from "../../../../infrastructure/db/repositories/MessageRepository.ts";
import { humanInteractionQueue } from "../../../microkernel/human-interaction.ts";

const RECALL_TOOL_NAME = "recall_past_conversations";
const ASK_USER_TOOL_NAME = "ask_user";

const RecallSchema = z.object({
  query: z.string().describe("What to search for in past conversations"),
  limit: z.number().int().min(1).max(20).default(10).optional(),
});

const AskUserSchema = z.object({
  question: z
    .string()
    .describe(
      "The specific, direct question to ask the user to resolve the ambiguity. Should be answerable in a short reply.",
    ),
  options: z
    .array(z.string())
    .max(6)
    .optional()
    .describe(
      "If the answer is naturally one of a small, known set of choices (e.g. the candidate file paths you found, or a fixed set of preferences), list them here so the user can pick with one click instead of typing. Omit this entirely for open-ended questions (e.g. asking for a name, a value, free text).",
    ),
});

type NativeTool = DynamicStructuredTool<
  z.ZodType,
  Record<string, unknown>,
  Record<string, unknown>,
  string,
  unknown,
  string
>;

function buildRecallTool(chatId: number): NativeTool {
  return tool(
    async ({ query, limit }: z.infer<typeof RecallSchema>) => {
      const db = getORM();
      const msgRepo = new MessageRepository(db);
      const results = await msgRepo.hybridSearchGlobal(
        query,
        limit ?? 10,
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
        "Search across OTHER past chat conversations, excluding the current one — facts, preferences, past decisions, or context from earlier sessions. Do NOT use this for information already present in the current conversation's messages (check those first); this tool cannot see the current chat and will return nothing for facts mentioned here. Use it only when the user references something from a previous, different chat.",
      schema: RecallSchema,
    },
  );
}

function buildAskUserTool(): NativeTool {
  return tool(
    async ({ question, options }: z.infer<typeof AskUserSchema>) => {
      const { wait } = humanInteractionQueue.requestClarification(
        ASK_USER_TOOL_NAME,
        { kind: "clarify", question, options },
      );
      const answer = await wait;

      return answer
        ? `You asked the user: "${question}"\nThe user answered: "${answer}"\nUse this answer now to continue the task you were already working on — call whatever tool you originally needed with this information filled in. Do not ask the same question again, and do not treat this answer as a new, unrelated request.`
        : "The user did not answer in time. Proceed with your best judgment, or explain to the user that you need this information to continue.";
    },
    {
      name: ASK_USER_TOOL_NAME,
      description:
        "Ask the user a direct clarifying question when a required detail for another tool is missing or ambiguous in their request (e.g. which folder, which file among several candidates, a preference only they can state) AND no available tool could discover it on its own. Do not use this as a substitute for exploring first — only after you've exhausted what tools can find out. If the valid answers are a small known set (e.g. the specific candidates you found), pass them as `options` so the user can pick one instead of typing. This pauses your turn until the user replies.",
      schema: AskUserSchema,
    },
  );
}

export function buildNativeTools(chatId: number): NativeTool[] {
  return [buildRecallTool(chatId), buildAskUserTool()];
}

export function getNativeTool(
  name: string,
  chatId: number,
): NativeTool | undefined {
  return buildNativeTools(chatId).find((t) => t.name === name);
}
