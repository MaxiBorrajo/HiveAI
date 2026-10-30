import { postSse } from "../../../lib/sse";
import type { PluginDraft, TestSuiteQualityReport } from "../types";

export interface GeneratePluginDraftPayload {
  content: string;
  sessionId?: string;
  currentDraft?: PluginDraft;
}

export interface GeneratePluginDraftHandlers {
  onSessionCreated?: (sessionId: string) => void;
  onPlanning?: (thoughts: string) => void;
  onSignatureDrafted?: (signature: PluginDraft["signature"]) => void;
  onProcessDrafted?: (process: PluginDraft["process"]) => void;
  onTestsDrafted?: (tests: PluginDraft["tests"]) => void;
  onValidating?: () => void;
  onValidationError?: (data: { attempt: number; issues: string[] }) => void;
  onDraftReady?: (data: {
    draft: PluginDraft;
    sourceCode: string;
    qualityReport?: TestSuiteQualityReport;
  }) => void;
  onDone?: (data: {
    sessionId: string;
    draft: PluginDraft;
    sourceCode: string;
    qualityReport?: TestSuiteQualityReport;
  }) => void;
  onError?: (message: string) => void;
}

export async function generatePluginDraftStream(
  payload: GeneratePluginDraftPayload,
  handlers: GeneratePluginDraftHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await postSse(
    "/api/plugin-builder/generate",
    payload,
    (eventName, data) => {
      switch (eventName) {
        case "session_created":
          handlers.onSessionCreated?.(String(data.sessionId));
          break;
        case "planning":
          handlers.onPlanning?.(data.thoughts);
          break;
        case "signature_drafted":
          handlers.onSignatureDrafted?.(data.signature);
          break;
        case "process_drafted":
          handlers.onProcessDrafted?.(data.process);
          break;
        case "tests_drafted":
          handlers.onTestsDrafted?.(data.tests);
          break;
        case "validating":
          handlers.onValidating?.();
          break;
        case "validation_error":
          handlers.onValidationError?.(data);
          break;
        case "draft_ready":
          handlers.onDraftReady?.(data);
          break;
        case "done":
          handlers.onDone?.(data);
          break;
        case "error":
          handlers.onError?.(data.message);
          break;
      }
    },
    signal,
  );
}
