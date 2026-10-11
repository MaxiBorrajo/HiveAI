import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { useSlidePresence } from "@/hooks/useSlidePresence";
import { ScrollArea } from "../../../components/ui/scroll-area.tsx";
import { Button } from "../../../components/ui/button.tsx";
import {
  formatTokens,
  formatTokensPerSecond,
  hasTokens,
} from "@/lib/formatUsage";
import type {
  ConversationUsage,
  UsageBucket,
  UsageLocation,
} from "../types.ts";
import { UsageLocationIcon } from "@/components/UsageLocationIcon";

const PROVIDER_LABELS: Record<string, string> = {
  ollama: "Ollama",
  anthropic: "Anthropic",
  google: "Google Gemini",
};

function Figures({
  tokens,
}: {
  tokens: Pick<
    UsageBucket,
    | "inputTokens"
    | "outputTokens"
    | "cacheReadTokens"
    | "cacheWriteTokens"
    | "tokensComplete"
  >;
}) {
  return (
    <span>
      in {formatTokens(tokens.inputTokens, tokens.tokensComplete)} · out{" "}
      {formatTokens(tokens.outputTokens, tokens.tokensComplete)}
      {hasTokens(tokens.cacheReadTokens) &&
        ` · cache read ${formatTokens(tokens.cacheReadTokens)}`}
      {hasTokens(tokens.cacheWriteTokens) &&
        ` · cache write ${formatTokens(tokens.cacheWriteTokens)}`}
    </span>
  );
}

function Section({
  location,
  bucket,
}: {
  location: UsageLocation;
  bucket: UsageBucket;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 border-b border-border pb-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <UsageLocationIcon location={location} className="size-3.5" />
          {location === "cloud" ? "Cloud" : "Local"}
        </h3>
        <p className="font-mono text-xs text-muted-foreground">
          <Figures tokens={bucket} /> · {bucket.calls} call
          {bucket.calls === 1 ? "" : "s"}
          {bucket.failedCalls > 0 && ` (${bucket.failedCalls} failed)`}
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {bucket.models.map((m) => (
          <li
            key={`${m.provider}/${m.model}`}
            className="flex flex-col gap-0.5"
          >
            <span className="font-mono text-xs text-foreground break-all">
              {m.model}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {PROVIDER_LABELS[m.provider] ?? m.provider}
              {m.keyAliases.length > 0 && ` · key ${m.keyAliases.join(", ")}`}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              <Figures tokens={m} /> · {formatTokensPerSecond(m.tokensPerSecond)}{" "}
              · {m.calls} call{m.calls === 1 ? "" : "s"}
              {m.failedCalls > 0 && ` (${m.failedCalls} failed)`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ConversationUsagePanel({
  usage,
  open,
  onOpenChange,
}: {
  usage: ConversationUsage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { mounted, shown } = useSlidePresence(open);
  const sections = usage
    ? (["local", "cloud"] as const).filter((l) => usage[l].calls > 0)
    : [];

  return (
    <DialogPrimitive.Root open={mounted} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-background/40" />
        <DialogPrimitive.Popup
          // `right` is animated instead of a transform: the desktop webview
          // flickers on composited animations of big layers.
          style={{ right: shown ? 0 : "-24rem" }}
          className="fixed top-0 z-50 flex h-screen w-full max-w-sm flex-col gap-4 border-l border-border bg-popover p-4 text-popover-foreground shadow-xl outline-none transition-[right] duration-200 ease-out"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <DialogPrimitive.Title className="font-heading text-base font-medium">
                Conversation usage
              </DialogPrimitive.Title>
              <p className="text-xs text-muted-foreground">
                Local and cloud are shown separately.
              </p>
            </div>
            <DialogPrimitive.Close
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="flex flex-col gap-6 pr-2">
              {usage && sections.length > 0 ? (
                sections.map((location) => (
                  <Section
                    key={location}
                    location={location}
                    bucket={usage[location]}
                  />
                ))
              ) : (
                <p className="text-xs text-muted-foreground">
                  No usage was recorded for this conversation.
                </p>
              )}
            </div>
          </ScrollArea>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
