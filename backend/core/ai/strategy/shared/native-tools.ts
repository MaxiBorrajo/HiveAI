import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getORM } from "../../../../infrastructure/db/orm.ts";
import { MessageRepository } from "../../../../infrastructure/db/repositories/message-repository.ts";
import { humanInteractionQueue } from "../../../microkernel/human-interaction.ts";
import {
  createGeneratedFile,
  GENERATED_FORMATS_LABEL,
  generatedFilesStorage,
  type GeneratedFilesContext,
} from "../../../attachments/generated-files.ts";

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

const CREATE_FILE_TOOL_NAME = "create_file";

const CreateFileSchema = z.object({
  fileName: z
    .string()
    .describe("File name with its extension, e.g. 'report.docx', 'sales.csv', 'notes.md', 'script.py'."),
  content: z
    .string()
    .describe(
      "The whole content of the file. For .docx and .pdf write Markdown (# headings, paragraphs, - or 1. lists, **bold**, *italic*, | tables |): it is turned into a Word document or a PDF. For .csv use a header row.",
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
        ? `You asked the user: "${question}"\nThe user answered: "${answer}"\nContinue the task you were already doing using this answer.`
        : "The user did not answer in time. Proceed with your best judgment, or explain to the user that you need this information to continue.";
    },
    {
      name: ASK_USER_TOOL_NAME,
      description:
        "Ask the user one direct question when a required detail is missing or ambiguous and no tool could find it out (e.g. which folder, which of several files, a preference only they can state). Explore with tools first. If the valid answers are a small known set, pass them as `options`. Pauses your turn until the user replies.",
      schema: AskUserSchema,
    },
  );
}

function buildCreateFileTool(context: GeneratedFilesContext): NativeTool {
  return tool(
    async ({ fileName, content }: z.infer<typeof CreateFileSchema>) => {
      try {
        const file = await createGeneratedFile(context, fileName, content);
        return `Created '${file.originalName}' (${file.sizeBytes} bytes). It is attached to your reply, where the user can preview and download it: mention it briefly instead of repeating its content.`;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        context.onFailure(`Could not create '${fileName}': ${detail}`);
        throw new Error(`the file was not created. ${detail}`);
      }
    },
    {
      name: CREATE_FILE_TOOL_NAME,
      description:
        `Creates a file and attaches it to your reply in this chat, where the user can preview and download it. USE CASES: the user wants a result as a file (a document, report, table, CSV, JSON, Markdown, Word document, PDF or code file): "give me this as a CSV", "generate a Word document with...", "make me a PDF of...", "write a script that...". The format comes from the extension: ${GENERATED_FORMATS_LABEL}. Do not use it to save a file at a path on the user's computer: use file_ops for that.`,
      schema: CreateFileSchema,
    },
  );
}

export function buildNativeTools(chatId: number | string): NativeTool[] {
  const generatedFiles = generatedFilesStorage.getStore();
  return [
    buildRecallTool(Number(chatId)),
    buildAskUserTool(),
    ...(generatedFiles ? [buildCreateFileTool(generatedFiles)] : []),
  ];
}

export function getNativeTool(
  name: string,
  chatId: number | string,
): NativeTool | undefined {
  return buildNativeTools(chatId).find((t) => t.name === name);
}
