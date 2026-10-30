import { useRef } from "react";
import { useKeyedState } from "@/hooks/useKeyedState";
import { generatePluginDraftStream } from "../api/generatePluginDraft";
import { updatePluginDraft as updatePluginDraftRequest } from "../api/updatePluginDraft";
import { runDraftTest as runDraftTestRequest, type DraftTestKind } from "../api/runDraftTest";
import { installPluginDraft as installPluginDraftRequest } from "../api/installPluginDraft";
import { discardPluginDraft as discardPluginDraftRequest } from "../api/discardPluginDraft";
import { newActivityEntry, type ActivityEntry } from "../lib/pluginBuilderActivity";
import type { DraftTestResult, PluginDraft, TestSuiteQualityReport } from "../types";

export interface PluginBuilderWorkspaceOptions {
  key: string;
  sessionId: string | null;
  onSessionCreated: (sessionId: string) => void;
}

export function usePluginBuilderWorkspace({
  key,
  sessionId,
  onSessionCreated,
}: PluginBuilderWorkspaceOptions) {
  const isThinking = useKeyedState(key, false);
  const draft = useKeyedState<PluginDraft | null>(key, null);
  const sourceCode = useKeyedState<string | null>(key, null);
  const activity = useKeyedState<ActivityEntry[]>(key, []);
  const qualityReport = useKeyedState<TestSuiteQualityReport | null>(key, null);
  const testResults = useKeyedState<Record<string, DraftTestResult>>(key, {});
  const isInstalling = useKeyedState(key, false);

  const generateAbortRef = useRef<AbortController | null>(null);
  const justCreatedIdRef = useRef<string | null>(null);

  const moveAllKeys = (from: string, to: string) =>
    [draft, sourceCode, activity, qualityReport, testResults].forEach((state) =>
      state.moveKey(from, to),
    );

  const handleStop = () => generateAbortRef.current?.abort();

  const handleGenerate = async (prompt: string) => {
    const controller = new AbortController();
    generateAbortRef.current = controller;
    let currentKey = key;
    isThinking.set(true, currentKey);
    activity.set([], currentKey);
    testResults.set({}, currentKey);
    const note = (entry: Parameters<typeof newActivityEntry>[0]) =>
      activity.set((prev) => [...prev, newActivityEntry(entry)], currentKey);

    try {
      await generatePluginDraftStream(
        {
          content: prompt,
          sessionId: sessionId ?? undefined,
          currentDraft: draft.value ?? undefined,
        },
        {
          onSessionCreated: (id) => {
            justCreatedIdRef.current = id;
            moveAllKeys(currentKey, id);
            currentKey = id;
            onSessionCreated(id);
          },
          onPlanning: (thoughts) => {
            note({ kind: "planning", text: thoughts });
          },
          onSignatureDrafted: (signature) => {
            note({ kind: "signature", text: `Drafted signature: ${signature.name}` });
          },
          onProcessDrafted: () => {
            note({ kind: "process", text: "Drafted process() implementation" });
          },
          onTestsDrafted: (tests) => {
            note({
              kind: "tests",
              text: `Drafted ${tests.selectionTests.length + tests.executionTests.length} tests`,
            });
          },
          onValidating: () => {
            note({ kind: "validating", text: "Validating draft..." });
          },
          onValidationError: ({ attempt, issues }) => {
            note({
              kind: "correction",
              text: `Fixing ${issues.length} issue${issues.length === 1 ? "" : "s"} (attempt ${attempt})`,
            });
          },
          onDone: (data) => {
            draft.set(data.draft, currentKey);
            sourceCode.set(data.sourceCode, currentKey);
            qualityReport.set(data.qualityReport ?? null, currentKey);
            note({ kind: "done", text: "Plugin draft ready" });
            isThinking.set(false, currentKey);
          },
          onError: (message) => {
            note({ kind: "error", text: message });
            isThinking.set(false, currentKey);
          },
        },
        controller.signal,
      );
    } catch (e: any) {
      if (controller.signal.aborted) {
        note({ kind: "error", text: "Generation stopped." });
      } else {
        note({ kind: "error", text: `Streaming error: ${e.message}` });
      }
    } finally {
      if (generateAbortRef.current === controller) generateAbortRef.current = null;
      isThinking.set(false, currentKey);
    }
  };

  const handleManualEdit = async (patch: PluginDraft) => {
    if (!sessionId) return;
    const { data } = await updatePluginDraftRequest(sessionId, patch);
    if (!data) return;
    draft.set(data.draft);
    sourceCode.set(data.sourceCode);
    qualityReport.set(data.qualityReport ?? null);
  };

  const handleRunTest = async (kindOfTest: DraftTestKind, index: number) => {
    if (!sessionId) return;
    const testKey = `${kindOfTest}:${index}`;
    const { data } = await runDraftTestRequest(sessionId, kindOfTest, index);
    if (data) {
      testResults.set((prev) => ({ ...prev, [testKey]: data }), sessionId);
    }
  };

  const handleInstall = async (): Promise<InstallOutcome> => {
    if (!sessionId) return { success: false, error: "No active session" };
    isInstalling.set(true);
    try {
      const { data, success, errors } = await installPluginDraftRequest(sessionId);
      if (success && data) {
        return { success: true, name: data.name, description: data.description };
      }
      return { success: false, error: errors?.join(" ") ?? "Could not install the plugin." };
    } finally {
      isInstalling.set(false);
    }
  };

  const handleDiscard = async () => {
    if (!sessionId) return;
    await discardPluginDraftRequest(sessionId);
    draft.set(null);
    sourceCode.set(null);
    qualityReport.set(null);
    testResults.set({});
    activity.set([]);
  };

  return {
    isThinking: isThinking.value,
    draft: draft.value,
    sourceCode: sourceCode.value,
    activity: activity.value,
    qualityReport: qualityReport.value,
    testResults: testResults.value,
    isInstalling: isInstalling.value,
    handleGenerate,
    handleStop,
    handleManualEdit,
    handleRunTest,
    handleInstall,
    handleDiscard,
  };
}

export interface InstallOutcome {
  success: boolean;
  name?: string;
  description?: string;
  error?: string;
}
