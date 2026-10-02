import { assert, assertStringIncludes } from "@std/assert";
import {
  AGENT_EMPTY_RESPONSE_PROMPT,
  AGENT_OUT_OF_ITERATIONS_PROMPT,
  buildAgentSystemPrompt,
} from "./prompt.ts";

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
