import { assert, assertStringIncludes } from "@std/assert";
import {
  AGENT_EMPTY_RESPONSE_PROMPT,
  AGENT_OUT_OF_ITERATIONS_PROMPT,
  buildAgentSystemPrompt,
} from "../../../../../../../core/ai/strategy/scout/agent/prompt.ts";

Deno.test("buildAgentSystemPrompt includes the current date", () => {
  const prompt = buildAgentSystemPrompt();
  const currentDate = new Date().toISOString().split("T")[0];

  assertStringIncludes(prompt, currentDate);
});

Deno.test("buildAgentSystemPrompt names the running operating system", () => {
  const prompt = buildAgentSystemPrompt();
  const expectedOsName: Record<string, string> = {
    windows: "Windows",
    darwin: "macOS",
    linux: "Linux",
  };
  const osName = expectedOsName[Deno.build.os] ?? Deno.build.os;

  assertStringIncludes(prompt, `OPERATING SYSTEM: ${osName}.`);
});

Deno.test("buildAgentSystemPrompt is deterministic within the same call context", () => {
  const first = buildAgentSystemPrompt();
  const second = buildAgentSystemPrompt();

  assert(first === second);
});

Deno.test("AGENT_OUT_OF_ITERATIONS_PROMPT tells the model to stop calling tools", () => {
  assertStringIncludes(
    AGENT_OUT_OF_ITERATIONS_PROMPT.toLowerCase(),
    "no more tools",
  );
});

Deno.test("AGENT_EMPTY_RESPONSE_PROMPT asks the model to answer instead of returning empty", () => {
  assertStringIncludes(
    AGENT_EMPTY_RESPONSE_PROMPT.toLowerCase(),
    "empty",
  );
});

Deno.test("buildAgentSystemPrompt cloud variant is much shorter and never claims to run locally", () => {
  const local = buildAgentSystemPrompt();
  const cloud = buildAgentSystemPrompt({ isCloud: true });

  assert(cloud.length < local.length * 0.6);
  assert(!/local model|never leaves|Nothing in this conversation leaves/i.test(cloud));
  assertStringIncludes(cloud, new Date().toISOString().split("T")[0]);
  assertStringIncludes(cloud, "ask_user");
});

Deno.test("buildAgentSystemPrompt cloud variant keeps date and OS after the stable instructions", () => {
  const cloud = buildAgentSystemPrompt({ isCloud: true });

  assert(cloud.indexOf("CURRENT DATE") > cloud.indexOf("Answer:"));
  assert(cloud.indexOf("OPERATING SYSTEM") > cloud.indexOf("CURRENT DATE"));
});
