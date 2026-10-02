import { useMemo, useState } from "react";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, Square } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { Plugin } from "@/features/plugins/types";
import { saveTestResults } from "@/features/plugins/api/saveTestResults";
import { buildPluginTestGroups } from "@/features/plugins/tests/testRunner";
import { reportSuccess } from "@/lib/toastManager";
import { toggleInSet } from "@/lib/toggleInSet";
import { TestCardItem } from "./TestCardItem";
import { TestSummaryPanel } from "./TestSummaryPanel";
import { usePluginTestRunner } from "./usePluginTestRunner";

export function PluginTestsView({
  plugins,
  onBack,
}: {
  plugins: Plugin[];
  onBack: () => void;
}) {
  const pluginsWithTests = useMemo(() => buildPluginTestGroups(plugins), [plugins]);
  const allTests = useMemo(
    () => pluginsWithTests.flatMap((p) => p.tests),
    [pluginsWithTests],
  );

  const {
    selectedIds,
    allSelected,
    results,
    isRunning,
    isFinished,
    completedCount,
    testsToRunCount,
    progressPercent,
    summary,
    toggleTest,
    toggleAll,
    run,
  } = usePluginTestRunner(allTests);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => setExpanded((prev) => toggleInSet(prev, id));

  const toggleAllExpand = () => {
    if (expanded.size > 0) {
      setExpanded(new Set());
    } else {
      setExpanded(new Set(Object.keys(results).filter((id) => !!results[id]?.details)));
    }
  };

  const downloadResults = async () => {
    const rows = allTests
      .filter((t) => selectedIds.has(t.id))
      .map((t) => {
        const res = results[t.id];
        return {
          pluginName: t.pluginName,
          type: t.type,
          kind: t.kind,
          label: t.label,
          status: res?.status || "idle",
          errors: res?.errors || [],
          failureCategory: res?.failureCategory || null,
          details: res?.details || null,
          metrics: res?.metrics || null,
        };
      });

    try {
      const { data } = await saveTestResults({ summary, results: rows });
      if (data?.path) reportSuccess("Results saved", data.path);
    } catch {
      // apiClient already reports the failure
    }
  };

  const titleText = plugins.length === 1 ? plugins[0].name : "Test Results";

  return (
    <>
      <DialogHeader className="p-4 flex flex-row items-center gap-3 space-y-0 border-b border-border">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          disabled={isRunning}
          className="shrink-0 -ml-2"
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </Button>
        <div className="flex-1 min-w-0">
          <DialogTitle className="font-mono text-sm">{titleText}</DialogTitle>
        </div>
      </DialogHeader>

      <div className="flex flex-col border-b border-border bg-muted/20">
        <div className="flex items-center justify-between px-6 pb-3">
          <div className="flex items-center gap-6">
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

            {completedCount > 0 && (
              <button
                type="button"
                onClick={toggleAllExpand}
                className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                {expanded.size > 0 ? "Hide Results" : "View Results"}
              </button>
            )}

            {summary && (
              <>
                <button
                  type="button"
                  onClick={downloadResults}
                  className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  Download Results
                </button>
              </>
            )}
          </div>

          <Button
            size="sm"
            onClick={run}
            disabled={selectedIds.size === 0}
            variant={isRunning ? "destructive" : "default"}
            className="h-8 text-xs font-semibold shadow-sm"
          >
            {isRunning ? (
              <Square size={14} className="mr-1.5 fill-current" />
            ) : (
              <Play size={14} className="mr-1.5 fill-current" />
            )}
            {isRunning ? "Stop" : "Run Selected"}
          </Button>
        </div>

        {(isRunning || (completedCount > 0 && !isFinished)) && (
          <div className="flex items-center gap-3 px-6 py-2 bg-muted/10 border-t border-border text-xs font-medium">
            <div className="flex-1 h-2 bg-muted overflow-hidden rounded-full border border-border">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="tabular-nums text-muted-foreground whitespace-nowrap">
              {progressPercent}% ({completedCount}/{testsToRunCount})
            </span>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 p-6 pt-4 bg-muted/10">
        <div className="flex flex-col gap-4">
          {summary && (
            <TestSummaryPanel
              summary={summary}
              testsToRunCount={testsToRunCount}
            />
          )}

          <Accordion
            multiple
            defaultValue={pluginsWithTests.map((p) => p.pluginName)}
            className="w-full space-y-4"
          >
            {pluginsWithTests.map((group) => (
              <AccordionItem
                key={group.pluginName}
                value={group.pluginName}
                className="border rounded-lg bg-card overflow-hidden"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline bg-muted/30">
                  <div className="flex items-center gap-2 font-semibold">
                    <span>{group.pluginName}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      ({group.tests.length} tests)
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="p-4 flex flex-col gap-4 border-t">
                  {group.tests.map((test) => {
                    const id = test.id;
                    const isSelected = selectedIds.has(id);
                    const res = results[id];

                    return (
                      <TestCardItem
                        key={id}
                        id={id}
                        test={test}
                        isSelected={isSelected}
                        isExpanded={expanded.has(id)}
                        onToggleExpand={toggleExpand}
                        res={res}
                        onToggle={toggleTest}
                        isRunning={isRunning}
                      />
                    );
                  })}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </ScrollArea>
    </>
  );
}
