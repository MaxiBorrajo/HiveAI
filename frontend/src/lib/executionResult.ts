import type { ExecutionResult } from "@/types/execution";

export function normalizeResult(rawResult: any): ExecutionResult {
  const isStructured =
    rawResult &&
    typeof rawResult === "object" &&
    typeof rawResult.type === "string" &&
    "content" in rawResult;
  if (isStructured) return rawResult as ExecutionResult;

  let type: ExecutionResult["type"] = "text";
  if (typeof rawResult === "boolean") {
    type = "boolean";
  } else if (
    typeof rawResult === "string" &&
    (rawResult.includes("#") || rawResult.includes("**") || rawResult.includes("```"))
  ) {
    type = "markdown";
  } else if (typeof rawResult === "object" && rawResult !== null) {
    type = Array.isArray(rawResult) ? "table" : "json";
  }

  return { type, summary: "Execution result", content: rawResult };
}
