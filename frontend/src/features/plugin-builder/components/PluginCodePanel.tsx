import { useState } from "react";
import Editor from "@monaco-editor/react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DraftTestKind } from "../api/runDraftTest";
import type { DraftTestResult, PluginDraft, TestSuiteQualityReport } from "../types";

interface PluginCodePanelProps {
  draft: PluginDraft;
  sourceCode: string;
  qualityReport: TestSuiteQualityReport | null;
  testResults: Record<string, DraftTestResult>;
  onRunTest: (kind: DraftTestKind, index: number) => Promise<void>;
}

type Tab = "code" | "tests";

export function PluginCodePanel({
  draft,
  sourceCode,
  qualityReport,
  testResults,
  onRunTest,
}: PluginCodePanelProps) {
  const [tab, setTab] = useState<Tab>("code");
  const [runningKey, setRunningKey] = useState<string | null>(null);

  const runTest = async (kind: DraftTestKind, index: number) => {
    const key = `${kind}:${index}`;
    setRunningKey(key);
    try {
      await onRunTest(kind, index);
    } finally {
      setRunningKey(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-4 pt-3">
        <TabButton active={tab === "code"} onClick={() => setTab("code")}>
          Code
        </TabButton>
        <TabButton active={tab === "tests"} onClick={() => setTab("tests")}>
          Tests
          {qualityReport && (
            <span
              className={cn(
                "ml-1.5 rounded-full px-1.5 text-[10px]",
                qualityReport.valid
                  ? "bg-emerald-500/20 text-emerald-500"
                  : "bg-destructive/20 text-destructive",
              )}
            >
              {qualityReport.total}
            </span>
          )}
        </TabButton>
      </div>

      <div className="min-h-0 flex-1">
        {tab === "code" ? (
          <Editor
            path="file:///index.ts"
            language="typescript"
            value={sourceCode}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              automaticLayout: true,
            }}
            theme="vs-dark"
          />
        ) : (
          <div className="h-full overflow-y-auto p-4">
            {!qualityReport?.valid && qualityReport?.issues && qualityReport.issues.length > 0 && (
              <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <p className="mb-1 font-medium">Quality validator issues:</p>
                <ul className="list-disc pl-4">
                  {qualityReport.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            <TestSection
              title="Selection tests"
              kind="selection"
              count={draft.tests.selectionTests.length}
              testResults={testResults}
              runningKey={runningKey}
              onRunTest={runTest}
              renderLabel={(i) => {
                const t = draft.tests.selectionTests[i];
                return `[${t.kind}] ${t.query}`;
              }}
            />

            <TestSection
              title="Execution tests"
              kind="execution"
              count={draft.tests.executionTests.length}
              testResults={testResults}
              runningKey={runningKey}
              onRunTest={runTest}
              renderLabel={(i) => {
                const t = draft.tests.executionTests[i];
                return `[${t.kind}] ${t.description}`;
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center rounded-t-md px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-b-2 border-primary text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function TestSection({
  title,
  kind,
  count,
  testResults,
  runningKey,
  onRunTest,
  renderLabel,
}: {
  title: string;
  kind: DraftTestKind;
  count: number;
  testResults: Record<string, DraftTestResult>;
  runningKey: string | null;
  onRunTest: (kind: DraftTestKind, index: number) => void;
  renderLabel: (index: number) => string;
}) {
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-sm font-medium text-foreground">{title}</h3>
      <div className="flex flex-col gap-1">
        {Array.from({ length: count }, (_, i) => {
          const key = `${kind}:${i}`;
          const result = testResults[key];
          const running = runningKey === key;
          return (
            <div
              key={key}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
            >
              <button
                type="button"
                disabled={running}
                onClick={() => onRunTest(kind, i)}
                className="shrink-0 rounded-md border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {running ? <Loader2 className="size-3 animate-spin" /> : "Run"}
              </button>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {renderLabel(i)}
              </span>
              {result && (
                result.success ? (
                  <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle className="size-3.5 shrink-0 text-destructive" />
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
