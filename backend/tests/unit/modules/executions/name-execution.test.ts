import { assertEquals } from "@std/assert";
import {
  cleanExecutionName,
  MAX_EXECUTION_NAME_LENGTH,
} from "../../../../modules/executions/use-cases/generate-execution/name-execution.ts";

Deno.test("cleanExecutionName strips quotes, prefixes and trailing punctuation", () => {
  assertEquals(cleanExecutionName('"Resumen de artículos técnicos."'), "Resumen de artículos técnicos");
  assertEquals(cleanExecutionName("Título: Revisión de git"), "Revisión de git");
  assertEquals(cleanExecutionName("**Git status check**\nextra explanation"), "Git status check");
});

Deno.test("cleanExecutionName returns empty for unusable answers and caps the length", () => {
  assertEquals(cleanExecutionName("  \n "), "");
  const long = cleanExecutionName("palabra ".repeat(30));
  assertEquals(long.length <= MAX_EXECUTION_NAME_LENGTH, true);
  assertEquals(long.endsWith("…"), true);
});
