import {
  Check,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Box,
  Zap,
  Clock,
  Coins,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export function TestCardItem({
  test,
  id,
  isSelected,
  isExpanded,
  onToggleExpand,
  res,
  onToggle,
  isRunning,
}: any) {
  let kindColor = "bg-slate-100 text-slate-700 border-slate-200";
  let KindIcon = Box;

  if (test.kind === "positive" || test.kind === "happy") {
    kindColor = "bg-green-50 text-green-700 border-green-200";
    KindIcon = CheckCircle2;
  } else if (test.kind === "negative" || test.kind === "edge") {
    kindColor = "bg-orange-50 text-orange-700 border-orange-200";
    KindIcon = AlertTriangle;
  } else if (test.kind === "ambiguous" || test.kind === "error") {
    kindColor = "bg-red-50 text-red-700 border-red-200";
    KindIcon = XCircle;
  }

  const hasResults = !!res?.details;

  return (
    <div className="flex flex-col gap-2">
      <label
        className={`flex flex-col gap-3 rounded-xl border p-4 cursor-pointer transition-all bg-card shadow-sm min-w-0 ${
          isSelected
            ? "border-primary ring-1 ring-primary/20"
            : "border-border hover:border-border/80"
        }`}
      >
        <div className="flex items-start gap-4">
          <div className="pt-1">
            <input
              type="checkbox"
              title="Select or deselect this test"
              checked={isSelected}
              onChange={() => onToggle(id)}
              disabled={isRunning}
              className="size-4 shrink-0 accent-primary cursor-pointer"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span
                title="Test category: whether it tests LLM tool selection or direct execution"
                className={`text-[10px] cursor-help font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                  test.type === "selection"
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-purple-50 text-purple-700 border-purple-200"
                }`}
              >
                {test.type}
              </span>
              <span
                title="Type of scenario this test represents"
                className={`text-[10px] cursor-help font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border flex items-center gap-1 ${kindColor}`}
              >
                <KindIcon size={10} />
                {test.kind}
              </span>

              {/* Performance Metrics */}
              <div className="flex items-center gap-2 ml-auto">
                {res?.metrics?.inputTokens !== undefined &&
                  res?.metrics?.outputTokens !== undefined && (
                    <span
                      title="Tokens (Input / Output)"
                      className="flex items-center gap-1 text-[10px] cursor-help bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-sm font-mono border border-slate-200"
                    >
                      <Coins size={10} />
                      {res.metrics.inputTokens} / {res.metrics.outputTokens}
                    </span>
                  )}
                {res?.metrics?.tokensPerSecond ? (
                  <span
                    title="Tokens generated per second"
                    className="flex items-center gap-1 text-[10px] cursor-help bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-sm font-mono border border-slate-200"
                  >
                    <Zap size={10} />
                    {res.metrics.tokensPerSecond} t/s
                  </span>
                ) : null}
                {res?.metrics?.durationMs !== undefined && (
                  <span
                    title="Execution duration in seconds"
                    className="flex items-center gap-1 text-[10px] cursor-help bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-sm font-mono border border-slate-200"
                  >
                    <Clock size={10} />
                    {(res.metrics.durationMs / 1000).toFixed(2)}s
                  </span>
                )}
              </div>
            </div>

            <p
              title={
                test.type === "selection"
                  ? "The simulated user prompt"
                  : "Description of the execution scenario"
              }
              className="text-sm cursor-help text-foreground font-medium mb-1"
            >
              {test.label}
            </p>

            {/* Failure Category Badge */}
            {res?.failureCategory && (
              <div className="mt-2 mb-1">
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-800 text-[10px] font-bold uppercase tracking-wider rounded-md border border-red-200">
                  <AlertTriangle size={12} />
                  Failure: {res.failureCategory}
                </span>
              </div>
            )}

            {test.type === "selection" && (test as any).expectedParams && (
              <div
                title="The exact parameters the LLM is expected to extract from the query"
                className="mt-3 bg-muted/50 rounded-md p-2.5 border border-border/50 cursor-help"
              >
                <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">
                  Expected Params
                </p>
                <pre className="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap">
                  {JSON.stringify((test as any).expectedParams, null, 2)}
                </pre>
              </div>
            )}

            {test.type === "execution" && (test as any).params && (
              <div
                title="The exact parameters passed directly into the plugin's process method"
                className="mt-3 bg-muted/50 rounded-md p-2.5 border border-border/50 cursor-help"
              >
                <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1">
                  Params
                </p>
                <pre className="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap">
                  {JSON.stringify((test as any).params, null, 2)}
                </pre>
              </div>
            )}

            {res?.errors && res.errors.length > 0 && (
              <div
                title="Errors resulting from the test failure"
                className="mt-3 bg-destructive/10 cursor-help text-destructive rounded-md p-3 border border-destructive/20"
              >
                <ul className="text-xs list-disc list-inside space-y-1">
                  {res.errors.map((err: string, i: number) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* View Results Toggle Button */}
            {hasResults && (
              <div className="mt-4 pt-4 border-t border-border flex justify-center">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault(); // prevent triggering the label checkbox
                    e.stopPropagation();
                    onToggleExpand(id);
                  }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors bg-muted/30 hover:bg-muted/50 px-3 py-1.5 rounded-full border border-border/50"
                >
                  {isExpanded ? (
                    <>
                      Hide Results <ChevronUp size={14} />
                    </>
                  ) : (
                    <>
                      View Results <ChevronDown size={14} />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
          <div className="shrink-0 pt-1">
            {res?.status === "running" && (
              <Loader2 size={18} className="animate-spin text-primary" />
            )}
            {res?.status === "success" && (
              <Check size={18} className="text-green-500" />
            )}
            {res?.status === "error" && (
              <X size={18} className="text-destructive" />
            )}
          </div>
        </div>
      </label>

      {/* Actual Results Accordion Panel */}
      {hasResults && isExpanded && (
        <div
          title="The actual results returned during the test"
          className="rounded-xl border border-border bg-card shadow-sm p-4 text-foreground cursor-help min-w-0 animate-in slide-in-from-top-2 fade-in-0 duration-200"
        >
          <p className="text-[10px] uppercase font-bold text-muted-foreground mb-3 flex items-center gap-1 border-b border-border pb-2">
            <CheckCircle2 size={12} className="text-muted-foreground" /> Actual
            Results
          </p>
          {test.type === "selection" ? (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">
                  Selected Tool
                </p>
                <div className="font-mono text-xs bg-muted/50 px-2 py-1.5 rounded-md border border-border inline-block">
                  {res.details.selectedTool || "none"}
                </div>
              </div>
              {res.details.extractedParams && (
                <div>
                  <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">
                    Extracted Params
                  </p>
                  <pre className="text-[11px] font-mono text-foreground/90 bg-muted/50 p-2.5 rounded-md border border-border whitespace-pre-wrap">
                    {JSON.stringify(res.details.extractedParams, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">
                Plugin Output
              </p>
              <pre className="text-[11px] font-mono text-foreground/90 bg-muted/50 p-2.5 rounded-md border border-border whitespace-pre-wrap overflow-y-auto max-h-[300px]">
                {res.details.output || "<empty>"}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
