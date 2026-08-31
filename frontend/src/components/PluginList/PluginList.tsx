import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlugins, setPluginActive, runPluginTest } from "@/lib/get-plugins";
import type { Plugin } from "@/types/plugin";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Check,
  X,
  Play,
  Square,
} from "lucide-react";

type TestStatus = "idle" | "running" | "success" | "error";
interface TestResult {
  status: TestStatus;
  errors?: string[];
}

export function PluginList() {
  const [plugins, setPlugins] = useState<Plugin[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, Record<number, TestResult>>
  >({});
  const [abortControllers, setAbortControllers] = useState<
    Record<string, AbortController>
  >({});

  useEffect(() => {
    getPlugins().then(setPlugins);
  }, []);

  async function toggle(
    plugin: Plugin,
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const nextActive = e.target.checked;
    setPlugins(
      (prev) =>
        prev?.map((p) =>
          p.id === plugin.id ? { ...p, active: nextActive } : p,
        ) ?? prev,
    );

    try {
      await setPluginActive(plugin.name, nextActive);
    } catch {
      setPlugins(
        (prev) =>
          prev?.map((p) =>
            p.id === plugin.id ? { ...p, active: plugin.active } : p,
          ) ?? prev,
      );
    }
  }

  function toggleExpand(pluginName: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setExpanded((prev) => (prev === pluginName ? null : pluginName));
  }

  async function runTests(plugin: Plugin, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (abortControllers[plugin.name]) {
      abortControllers[plugin.name].abort();
      setAbortControllers((prev) => {
        const next = { ...prev };
        delete next[plugin.name];
        return next;
      });
      return;
    }

    const controller = new AbortController();
    setAbortControllers((prev) => ({ ...prev, [plugin.name]: controller }));

    for (let i = 0; i < (plugin.testCases?.length || 0); i++) {
      if (controller.signal.aborted) break;

      setTestResults((prev) => ({
        ...prev,
        [plugin.name]: {
          ...(prev[plugin.name] || {}),
          [i]: { status: "running" },
        },
      }));

      try {
        const res = await runPluginTest(plugin.name, i, controller.signal);
        setTestResults((prev) => ({
          ...prev,
          [plugin.name]: {
            ...(prev[plugin.name] || {}),
            [i]: {
              status: res.success ? "success" : "error",
              errors: res.errors,
            },
          },
        }));
      } catch (err: any) {
        if (err.name === "AbortError") break;
        setTestResults((prev) => ({
          ...prev,
          [plugin.name]: {
            ...(prev[plugin.name] || {}),
            [i]: { status: "error", errors: [err.message] },
          },
        }));
      }
    }

    setAbortControllers((prev) => {
      const next = { ...prev };
      delete next[plugin.name];
      return next;
    });
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-background">
      <div className="flex h-16 items-center border-b border-border px-4">
        <h2 className="text-xs font-mono text-muted-foreground">Plugins</h2>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-4">
          {plugins === null && (
            <>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </>
          )}

          {plugins?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay plugins registrados.
            </p>
          )}

          {plugins?.map((plugin) => {
            const isExpanded = expanded === plugin.name;
            const isRunning = !!abortControllers[plugin.name];
            const hasTests = plugin.testCases && plugin.testCases.length > 0;

            return (
              <div
                key={plugin.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-start gap-2.5">
                  <input
                    id={`plugin-${plugin.id}`}
                    type="checkbox"
                    checked={plugin.active}
                    onChange={(e) => toggle(plugin, e)}
                    className="mt-0.5 size-3.5 shrink-0 accent-primary"
                  />
                  <div className="flex-1">
                    <label
                      htmlFor={`plugin-${plugin.id}`}
                      className="cursor-pointer"
                    >
                      <p className="text-xs font-mono text-foreground">
                        {plugin.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {plugin.description}
                      </p>
                    </label>
                  </div>
                  {hasTests && (
                    <button
                      type="button"
                      onClick={(e) => toggleExpand(plugin.name, e)}
                      className="mt-0.5 text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? (
                        <ChevronUp size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                    </button>
                  )}
                </div>

                {isExpanded && hasTests && (
                  <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-muted-foreground">
                        Casos de prueba
                      </span>
                      <button
                        type="button"
                        onClick={(e) => runTests(plugin, e)}
                        className="flex items-center gap-1 rounded bg-secondary px-2 py-1 text-[10px] font-mono text-secondary-foreground hover:bg-secondary/80"
                      >
                        {isRunning ? <Square size={10} /> : <Play size={10} />}
                        {isRunning ? "Detener" : "Ejecutar"}
                      </button>
                    </div>

                    <div className="flex flex-col gap-2">
                      {plugin.testCases.map((test, index) => {
                        const res = testResults[plugin.name]?.[index];
                        return (
                          <div
                            key={index}
                            className="flex flex-col gap-1 rounded bg-background p-2 border border-border"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-[11px] text-foreground flex-1">
                                "{test.query}"
                              </p>
                              <div className="shrink-0 pt-0.5">
                                {res?.status === "running" && (
                                  <Loader2
                                    size={12}
                                    className="animate-spin text-primary"
                                  />
                                )}
                                {res?.status === "success" && (
                                  <Check size={12} className="text-green-500" />
                                )}
                                {res?.status === "error" && (
                                  <X size={12} className="text-destructive" />
                                )}
                              </div>
                            </div>
                            {res?.errors && res.errors.length > 0 && (
                              <ul className="text-[10px] text-destructive list-disc list-inside mt-1">
                                {res.errors.map((err, i) => (
                                  <li key={i}>{err}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
}
