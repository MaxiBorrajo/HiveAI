import { useEffect, useState } from "react";
import { Bot, Brain } from "lucide-react";
import { useModels } from "@/features/models/ModelsContext";
import { getModelSettings } from "../api/getModelSettings";
import { setModelSettings } from "../api/setModelSettings";
import { getAlwaysThinkingModels, onAlwaysThinking } from "../api/alwaysThinking";

export function ThinkingToggle() {
  const { current, models } = useModels();
  const [enabled, setEnabled] = useState(true);
  const [alwaysThinking, setAlwaysThinking] = useState<string[]>([]);

  const supportsThinking =
    current.provider === "ollama" &&
    !!models
      .find((m) => m.name === current.model)
      ?.capabilities.some((c) => c.toLowerCase() === "thinking");

  useEffect(() => {
    if (!supportsThinking) return;
    getModelSettings()
      .then(({ data }) => {
        const setting = data?.find((s) => s.name === "thinking");
        if (setting) setEnabled(setting.currentValue === true);
      })
      .catch(() => {});
  }, [supportsThinking, current.model]);

  useEffect(() => {
    if (!supportsThinking) return;
    getAlwaysThinkingModels()
      .then(({ data }) => setAlwaysThinking(data ?? []))
      .catch(() => {});
    return onAlwaysThinking((model) =>
      setAlwaysThinking((known) => (known.includes(model) ? known : [...known, model]))
    );
  }, [supportsThinking]);

  if (!supportsThinking) return null;

  // Off is only a request: this model has been seen reasoning all the same.
  const reasonsAnyway = !enabled && alwaysThinking.includes(current.model);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    try {
      await setModelSettings({ thinking: next });
    } catch {
      setEnabled(!next);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      title={
        enabled
          ? "Thinking on: the model reasons before answering. Click to turn it off for faster replies."
          : reasonsAnyway
            ? "Thinking off, but this model reasons anyway, so replies will not get faster. Its reasoning is shown apart from the answer. Click to turn it on."
            : "Thinking off: faster replies, less reasoning. Click to turn it on."
      }
      className={`flex items-center gap-2 rounded-md px-2 py-0.5 outline-none focus-visible:ring-1 focus-visible:ring-ring ${
        enabled
          ? "bg-primary/10 text-primary/70 ring-1 ring-primary/20 hover:bg-primary/20"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      }`}
    >
      {enabled ? (
        <Brain className="size-4 text-primary/50" />
      ) : (
        <Bot className="size-4 text-muted-foreground" />
      )}
      <span className="text-sm font-mono">
        {enabled ? "Reason" : "Direct"}
      </span>
      {reasonsAnyway && (
        <span className="size-1.5 rounded-full bg-amber-500" aria-label="This model reasons anyway" />
      )}
    </button>
  );
}
