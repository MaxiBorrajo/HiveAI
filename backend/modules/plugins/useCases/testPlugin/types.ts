export type TestKind = "execution" | "selection";

export interface TestErrorResponse {
  error: string;
}

export interface SelectionTestResult {
  failureCategory: string | undefined;
  details: {
    selectedTool?: string;
    extractedParams?: Record<string, unknown>;
    output?: string;
  };
  metrics: {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    tokensPerSecond: number;
  };
}

export interface ExecutionTestResult {
  failureCategory: string | undefined;
  details: {
    output?: string;
  };
  metrics: {
    durationMs: number;
  };
}
