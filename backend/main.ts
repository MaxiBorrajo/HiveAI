import { HiveMicrokernel } from "./microkernel/hive-microkernel.ts";
import { HiveMind } from "./ai/hive-queen.ts";
import {
  HumanMessage,
  AIMessage,
  type BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// 1. Configure the Backend
const hive = HiveMicrokernel.getInstance();
const homeDir = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")!;
const __dirname = dirname(fileURLToPath(import.meta.url));

const MODEL = "qwen3:8b";

async function main() {
  const pluginsDir = join(__dirname, "plugins");

  for await (const entry of Deno.readDir(pluginsDir)) {
    if (entry.isDirectory) {
      await hive.loadAndRegister(join(pluginsDir, entry.name));
    }
  }

  console.log(hive.getRegisteredPlugins().map((p) => p.name));
}

main().then(() =>
  Deno.serve((req: Request) => {
    const url = new URL(req.url);
    const headers = {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*", // To allow Vite requests in development
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (url.pathname === "/plugins") {
      const plugins = hive.getRegisteredPlugins().map((plugin) => ({
        name: plugin.name,
        description: plugin.description,
        active: hive.isActive(plugin.name),
        testCases: plugin.testCases || [],
      }));
      return Response.json(plugins, { headers });
    }

    const activateMatch = url.pathname.match(/^\/plugins\/([^/]+)\/activate$/);
    if (activateMatch && req.method === "POST") {
      const ok = hive.activate(decodeURIComponent(activateMatch[1]));
      return Response.json(
        { success: ok },
        { headers, status: ok ? 200 : 404 },
      );
    }

    const deactivateMatch = url.pathname.match(
      /^\/plugins\/([^/]+)\/deactivate$/,
    );
    if (deactivateMatch && req.method === "POST") {
      const ok = hive.deactivate(decodeURIComponent(deactivateMatch[1]));
      return Response.json(
        { success: ok },
        { headers, status: ok ? 200 : 404 },
      );
    }

    const testMatch = url.pathname.match(/^\/plugins\/([^/]+)\/test\/(\d+)$/);
    if (testMatch && req.method === "POST") {
      const pluginName = decodeURIComponent(testMatch[1]);
      const testIndex = parseInt(testMatch[2], 10);
      return handleTest(pluginName, testIndex, req, headers);
    }

    if (url.pathname === "/chat" && req.method === "POST") {
      return handleChat(req, headers);
    }

    return new Response(JSON.stringify("Welcome to HiveAI"), { headers });
  }),
);

hive.configure({
  dataDir: join(homeDir, ".hiveai", "storage"),
  model: MODEL,
});

let chatHistory: BaseMessage[] = [];

async function handleChat(
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const body = await req.json();

  const userText = body.message;

  console.log(
    `/chat received. Active bees right now: [${hive
      .getRegisteredPlugins()
      .filter((p) => hive.isActive(p.name))
      .map((p) => p.name)
      .join(", ")}]`,
  );

  // Add only the new message to the history that lives in memory
  const turnStart = chatHistory.length;
  chatHistory.push(new HumanMessage(userText));

  const result = await HiveMind.invoke({
    messages: chatHistory,
    model: MODEL,
  });

  console.log(result.messages.slice(-1, -4));

  chatHistory = result.messages;

  // Tools used during this turn (starting from the user's message)
  const usedTools = Array.from(
    new Set(
      chatHistory
        .slice(turnStart)
        .filter((message): message is ToolMessage =>
          ToolMessage.isInstance(message),
        )
        .map((message) => message.name)
        .filter((name): name is string => Boolean(name)),
    ),
  );

  const lastMessage = chatHistory[chatHistory.length - 1];

  return Response.json(
    { content: lastMessage.content, usedTools },
    { headers },
  );
}

async function handleTest(
  pluginName: string,
  index: number,
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const plugin = hive.getPlugin(pluginName);
  if (!plugin || !plugin.testCases || !plugin.testCases[index]) {
    return Response.json({ error: "Test not found" }, { status: 404, headers });
  }
  const testCase = plugin.testCases[index];

  const wasActive = hive.isActive(pluginName);
  if (!wasActive) hive.activate(pluginName);

  try {
    const result = await HiveMind.invoke(
      {
        messages: [new HumanMessage(testCase.query)],
        model: MODEL,
      },
      { signal: req.signal },
    );

    const messages = result.messages;
    const selectorMsg = messages[1];
    const toolCalls = AIMessage.isInstance(selectorMsg)
      ? selectorMsg.tool_calls || []
      : [];

    const wasInvoked = toolCalls.some((tc: any) => tc.name === pluginName);
    const errors: string[] = [];

    if (testCase.shouldInvoke && !wasInvoked) {
      errors.push("Expected plugin to be invoked, but it was not.");
    } else if (!testCase.shouldInvoke && wasInvoked) {
      errors.push("Expected plugin NOT to be invoked, but it was.");
    }

    if (wasInvoked && testCase.shouldInvoke && testCase.expectedParams) {
      const call = toolCalls.find((tc: any) => tc.name === pluginName)!;
      for (const [key, expectedVal] of Object.entries(
        testCase.expectedParams,
      )) {
        if (call.args[key] !== expectedVal) {
          errors.push(
            `Parameter '${key}' mismatch. Expected '${expectedVal}', got '${call.args[key]}'`,
          );
        }
      }
    }

    if (
      testCase.expectedOutputValues &&
      testCase.expectedOutputValues.length > 0
    ) {
      const finalMsg = messages[messages.length - 1];
      const finalContent = finalMsg?.content?.toString() || "";
      for (const expected of testCase.expectedOutputValues) {
        if (!finalContent.includes(expected)) {
          errors.push(`Expected final output to contain '${expected}'.`);
        }
      }
    }

    return Response.json({ success: errors.length === 0, errors }, { headers });
  } catch (err: any) {
    if (req.signal.aborted) {
      return Response.json(
        { error: "Aborted by user" },
        { status: 499, headers },
      );
    }
    return Response.json({ error: String(err) }, { status: 500, headers });
  } finally {
    if (!wasActive) hive.deactivate(pluginName);
  }
}
