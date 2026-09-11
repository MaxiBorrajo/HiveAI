import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { ScrollArea } from "../ui/scroll-area.tsx";
import { Button } from "../ui/button.tsx";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion.tsx";
import type { Message, ThinkingRun } from "../../types/chat.ts";

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// Pairs each step with the thinking run of the same node at the same
// occurrence index — e.g. the 2nd Executor step gets the 2nd Executor run —
// since both arrays accumulate one entry per node execution, in order,
// rather than merging repeats.
function matchThinkingRun(
  steps: NonNullable<Message["steps"]>,
  thinkingRuns: ThinkingRun[],
  index: number,
): ThinkingRun | undefined {
  const node = steps[index].node;
  const occurrence = steps.slice(0, index + 1).filter((s) => s.node === node).length - 1;
  const runsForNode = thinkingRuns.filter((run) => run.node === node);
  return runsForNode[occurrence];
}

export function StepsPanel({
  steps,
  thinkingRuns,
  open,
  onOpenChange,
}: {
  steps: NonNullable<Message["steps"]>;
  thinkingRuns: ThinkingRun[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const totalMs = steps.reduce((sum, step) => sum + step.durationMs, 0);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed top-0 right-0 z-50 flex h-screen w-full max-w-sm flex-col gap-4 border-l border-border bg-popover p-4 text-popover-foreground shadow-xl outline-none duration-150 data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right">
          <div className="flex items-center justify-between gap-2">
            <div>
              <DialogPrimitive.Title className="font-heading text-base font-medium">
                Pasos de la respuesta
              </DialogPrimitive.Title>
              <p className="text-xs text-muted-foreground">
                {steps.length} paso{steps.length === 1 ? "" : "s"} · {formatDuration(totalMs)} en total
              </p>
            </div>
            <DialogPrimitive.Close
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <XIcon />
              <span className="sr-only">Cerrar</span>
            </DialogPrimitive.Close>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <Accordion className="pr-2">
              {steps.map((step, index) => (
                <AccordionItem key={index} value={index}>
                  <AccordionTrigger>
                    <span className="flex flex-col items-start gap-0.5">
                      <span>
                        {step.node}
                        {step.label !== step.node && (
                          <span className="font-normal text-muted-foreground"> · {step.label}</span>
                        )}
                      </span>
                      <span className="text-[10px] font-normal text-muted-foreground">
                        {formatDuration(step.durationMs)}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {(() => {
                      const run = matchThinkingRun(steps, thinkingRuns, index);
                      return run?.text ? (
                        <div className="mb-2 rounded-md bg-muted/50 p-2">
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Razonamiento
                          </p>
                          <p className="whitespace-pre-wrap text-xs italic text-muted-foreground">
                            {run.text}
                          </p>
                        </div>
                      ) : null;
                    })()}
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {step.summary}
                    </p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </ScrollArea>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
