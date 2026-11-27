import { useMemo, useState } from "react";
import { InfoIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { compareRuns } from "../../lib/compareRuns";
import { compareRunSet } from "../../lib/compareRunSet";
import type { JudgeFocus } from "../../api/judgeChat";
import type { RunSummary } from "../../types";
import { AskBar } from "./compare/AskBar";
import { GradeControls } from "./compare/GradeControls";
import { MetricsTab } from "./compare/MetricsTab";
import { OverviewTab } from "./compare/OverviewTab";
import { ResultTab } from "./compare/ResultTab";
import { useJudgeChoice } from "./compare/useJudgeChoice";

type TabId = "overview" | "result" | "metrics";

const FOCUS_BY_TAB: Record<TabId, JudgeFocus> = {
  overview: "overview",
  result: "result",
  metrics: "tokens",
};

export function RunComparisonModal({
  executionId,
  runs,
  open,
  onOpenChange,
  onGraded,
}: {
  executionId: string | null;
  runs: RunSummary[] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGraded: () => void;
}) {
  const [tab, setTab] = useState<TabId>("overview");
  const [judge, pickJudge] = useJudgeChoice(executionId ?? "");
  const set = useMemo(() => (runs ? compareRunSet(runs) : null), [runs]);
  const pair = runs && runs.length === 2 ? runs : null;
  const comparison = useMemo(
    () => (pair ? compareRuns(pair[0], pair[1]) : null),
    [pair],
  );
  const pairWarnings = (comparison?.warnings ?? []).filter(
    (w) => w.code !== "differentInput" && w.code !== "inputNotRecorded",
  );
  const warnings = [...(set?.warnings ?? []), ...pairWarnings.map((w) => w.message)];

  const hasMetrics = pair !== null && comparison !== null;
  const hasJudge = executionId !== null;
  const available: TabId[] = [
    "overview",
    "result",
    ...(hasMetrics ? (["metrics"] as const) : []),
  ];
  const active = available.includes(tab) ? tab : "overview";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] flex-col gap-3 overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Compare runs</DialogTitle>
          <DialogDescription>
            Side by side. Grading with a judge is optional: read the results
            and decide, or ask a judge model about them.
          </DialogDescription>
        </DialogHeader>

        {runs && set && (
          <Tabs
            value={active}
            onValueChange={(value) => setTab(value as TabId)}
            className="min-h-0 flex-1 gap-3"
          >
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="result">Result</TabsTrigger>
              {hasMetrics && <TabsTrigger value="metrics">Metrics</TabsTrigger>}
            </TabsList>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
              {warnings.length > 0 && (
                <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {warnings.map((message, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden>•</span>
                      {message}
                    </li>
                  ))}
                </ul>
              )}

              <TabsContent value="overview" className="flex flex-col gap-3">
                <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
                  These are tokens, not prices. Different models are shown side
                  by side and are never added into a single figure. Ask the
                  judge to look up prices if you want a cost comparison.
                </p>
                {hasJudge && (
                  <GradeControls
                    executionId={executionId}
                    runs={runs}
                    judge={judge}
                    onJudgeChange={pickJudge}
                    onGraded={onGraded}
                  />
                )}
                <OverviewTab scores={set.scores} />
              </TabsContent>

              <TabsContent value="result">
                <ResultTab runs={runs} />
              </TabsContent>

              {hasMetrics && (
                <TabsContent value="metrics">
                  <MetricsTab pair={pair} comparison={comparison} />
                </TabsContent>
              )}

            </div>
          </Tabs>
        )}

        {runs && hasJudge && (
          <AskBar
            executionId={executionId}
            runs={runs}
            focus={FOCUS_BY_TAB[active]}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
