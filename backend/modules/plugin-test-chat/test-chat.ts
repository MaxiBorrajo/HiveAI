import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createSseResponse } from "../../core/api/sse.ts";
import { answerWithTools } from "../../core/ai/draft-chat/draft-chat.ts";
import { createChatModel } from "../../core/ai/providers/create-chat-model.ts";
import { normalizeModelRef } from "../../core/ai/providers/types.ts";
import { executionContextStorage } from "../../core/microkernel/human-interaction.ts";
import type { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import type { ExternalPluginHandle } from "../../core/microkernel/external-plugins/external-plugin-host.ts";

const LOG = "[Plugin Test Chat]";
const MAX_HISTORY_MESSAGES = 40;

export interface TestChatTurn {
  role: "user" | "assistant";
  content: string;
}

export function sanitizeHistory(raw: unknown): TestChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is TestChatTurn =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.length > 0,
    )
    .slice(-MAX_HISTORY_MESSAGES);
}

function buildSystemPrompt(pluginName: string): string {
  return `You are helping a developer try out a plugin they are building, called "${pluginName}". It is the only tool you have.

- Use the tool to carry out what the user asks and report what it returned, including errors, exactly and briefly.
- If the tool fails because a setting or secret is missing (for example a URL, token or password), say which one and tell the user to open "Settings" in the Test tab. Do not invent values.
- If the request cannot be done with this plugin, say so instead of guessing.
- Reply in the user's language.`;
}

/** The plugin as the only tool, with the real input schema it declares. */
export function buildPluginTool(handle: ExternalPluginHandle): StructuredToolInterface {
  const { plugin, jsonSchema } = handle;
  return tool(
    async (input: unknown) => String(await plugin.process(input)),
    {
      name: plugin.name,
      description: plugin.description,
      // deno-lint-ignore no-explicit-any
      schema: jsonSchema as any,
    },
  ) as unknown as StructuredToolInterface;
}

/**
 * Chat with a single plugin loaded in a throwaway subprocess, so it works for
 * drafts and for installed plugins that are inactive. Always runs the code
 * currently on disk. Nothing is persisted.
 */
export function handlePluginTestChat(
  hive: HiveMicrokernel,
  options: {
    dir: string;
    model: string;
    message: string | undefined;
    history: unknown;
  },
  headers: Record<string, string>,
): Response {
  return createSseResponse(headers, async (send) => {
    if (!options.message?.trim()) {
      send("error", { message: "Missing 'message' in request body." });
      return;
    }

    let handle: ExternalPluginHandle;
    try {
      handle = await hive.probeExternalPlugin(options.dir);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      send("error", { message: `The plugin could not be loaded: ${detail}` });
      return;
    }

    try {
      console.log(`${LOG} Plugin: "${handle.plugin.name}"`);
      const model = await createChatModel(normalizeModelRef(options.model), {
        temperature: 0.1,
      });
      const messages: BaseMessage[] = [
        new SystemMessage(buildSystemPrompt(handle.plugin.name)),
        ...sanitizeHistory(options.history).map((m) =>
          m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)
        ),
        new HumanMessage(options.message),
      ];

      // The plugin may ask for approval or clarification; those go through
      // the shared interaction queue like in any other chat.
      await executionContextStorage.run(
        { autoApprove: false, interactive: true },
        async () => {
          const generator = answerWithTools(model, [buildPluginTool(handle)], messages);
          let result = await generator.next();
          while (!result.done) {
            send(result.value.type, result.value);
            result = await generator.next();
          }
          send("answer", { content: result.value });
        },
      );
    } finally {
      await handle.stop();
    }
  });
}
