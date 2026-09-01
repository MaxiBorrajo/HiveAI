import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  Play,
  Square,
  Loader2,
  Check,
  X,
  TestTube,
} from "lucide-react";
import type { Plugin } from "@/types/plugin";
import { runPluginTest } from "@/lib/get-plugins";

type TestStatus = "idle" | "running" | "success" | "error";
interface TestResult {
  status: TestStatus;
  errors?: string[];
}

interface PluginsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  plugins: Plugin[];
  onToggle: (plugin: Plugin, nextActive: boolean) => void;
}

export function PluginsModal({
  isOpen,
  onOpenChange,
  plugins,
  onToggle,
}: PluginsModalProps) {
  const [selectedPluginName, setSelectedPluginName] = useState<string | null>(
    null,
  );

  // Reset internal view when modal closes
  function handleOpenChange(open: boolean) {
    if (!open) setSelectedPluginName(null);
    onOpenChange(open);
  }

  const selectedPlugin = plugins.find((p) => p.name === selectedPluginName);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-xl p-0 overflow-hidden flex flex-col h-[80vh] max-h-[600px]"
        showCloseButton={true}
      >
        {selectedPlugin ? (
          <PluginTestsView
            plugin={selectedPlugin}
            onBack={() => setSelectedPluginName(null)}
          />
        ) : (
          <PluginListView
            plugins={plugins}
            onToggle={onToggle}
            onSelectPlugin={setSelectedPluginName}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PluginListView({
  plugins,
  onToggle,
  onSelectPlugin,
}: {
  plugins: Plugin[];
  onToggle: PluginsModalProps["onToggle"];
  onSelectPlugin: (name: string) => void;
}) {
  return (
    <>
      <DialogHeader className="p-6 pb-2">
        <DialogTitle>Manage Plugins</DialogTitle>
      </DialogHeader>

      <ScrollArea className="flex-1 p-6 pt-2">
        <div className="flex flex-col gap-3">
          {plugins.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No plugins registered.
            </p>
          )}

          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <Switch
                  checked={plugin.active}
                  onCheckedChange={(checked) => onToggle(plugin, checked)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm font-semibold">
                    {plugin.name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {plugin.description}
                  </p>
                </div>

                {plugin.testCases && plugin.testCases.length > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onSelectPlugin(plugin.name)}
                    className="shrink-0 h-8 gap-1.5 px-3"
                  >
                    <TestTube size={14} />
                    <span>Tests</span>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </>
  );
}

function PluginTestsView({
  plugin,
  onBack,
}: {
  plugin: Plugin;
  onBack: () => void;
}) {
  const [selectedTests, setSelectedTests] = useState<Set<number>>(
    new Set(plugin.testCases?.map((_, i) => i) || []),
  );
  const [testResults, setTestResults] = useState<Record<number, TestResult>>(
    {},
  );
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);

  const isRunning = abortController !== null;
  const allTests = plugin.testCases || [];
  const allSelected =
    allTests.length > 0 && selectedTests.size === allTests.length;

  function toggleTest(index: number) {
    setSelectedTests((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedTests(new Set());
    } else {
      setSelectedTests(new Set(allTests.map((_, i) => i)));
    }
  }

  async function runSelectedTests() {
    if (isRunning) {
      abortController.abort();
      setAbortController(null);
      return;
    }

    const controller = new AbortController();
    setAbortController(controller);

    // Clear previous results for selected tests
    setTestResults((prev) => {
      const next = { ...prev };
      Array.from(selectedTests).forEach((i) => {
        delete next[i];
      });
      return next;
    });

    for (const i of Array.from(selectedTests).sort((a, b) => a - b)) {
      if (controller.signal.aborted) break;

      setTestResults((prev) => ({ ...prev, [i]: { status: "running" } }));

      try {
        const res = await runPluginTest(plugin.name, i, controller.signal);
        setTestResults((prev) => ({
          ...prev,
          [i]: {
            status: res.success ? "success" : "error",
            errors: res.errors,
          },
        }));
      } catch (err: any) {
        if (err.name === "AbortError") break;
        setTestResults((prev) => ({
          ...prev,
          [i]: { status: "error", errors: [err.message] },
        }));
      }
    }

    setAbortController(null);
  }

  return (
    <>
      <DialogHeader className="p-6 pb-4 border-b border-border flex flex-row items-center gap-3 space-y-0">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          disabled={isRunning}
          className="shrink-0 -ml-2"
        >
          <ArrowLeft size={16} />
        </Button>
        <div className="flex-1 min-w-0">
          <DialogTitle className="font-mono text-sm">
            {plugin.name} Tests
          </DialogTitle>
        </div>
      </DialogHeader>

      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-muted/20">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={isRunning || allTests.length === 0}
            className="size-4 accent-primary"
          />
          <span className="text-xs font-medium">Select all</span>
        </label>

        <Button
          size="sm"
          onClick={runSelectedTests}
          disabled={selectedTests.size === 0}
          variant={isRunning ? "destructive" : "default"}
          className="h-8 text-xs"
        >
          {isRunning ? (
            <Square size={14} className="mr-1.5" />
          ) : (
            <Play size={14} className="mr-1.5" />
          )}
          {isRunning ? "Stop" : "Run Selected"}
        </Button>
      </div>

      <ScrollArea className="flex-1 p-6 pt-4">
        <div className="flex flex-col gap-3">
          {allTests.map((test, index) => {
            const isSelected = selectedTests.has(index);
            const res = testResults[index];

            return (
              <label
                key={index}
                className={`flex flex-col gap-2 rounded-lg border p-3 cursor-pointer transition-colors ${isSelected ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleTest(index)}
                    disabled={isRunning}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground font-medium">
                      "{test.query}"
                    </p>
                    {res?.errors && res.errors.length > 0 && (
                      <ul className="text-[10px] text-destructive list-disc list-inside mt-2">
                        {res.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="shrink-0">
                    {res?.status === "running" && (
                      <Loader2
                        size={14}
                        className="animate-spin text-primary"
                      />
                    )}
                    {res?.status === "success" && (
                      <Check size={14} className="text-green-500" />
                    )}
                    {res?.status === "error" && (
                      <X size={14} className="text-destructive" />
                    )}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </ScrollArea>
    </>
  );
}
