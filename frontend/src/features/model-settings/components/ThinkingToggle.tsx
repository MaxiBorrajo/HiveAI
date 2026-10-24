import { useEffect, useState } from "react";
import { Bot, Brain } from "lucide-react";
import { useModels } from "@/features/models/ModelsContext";
import { getModelSettings } from "../api/getModelSettings";
import { setModelSettings } from "../api/setModelSettings";

export function ThinkingToggle() {
  const { current, models } = useModels();
  const [enabled, setEnabled] = useState(true);

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

  if (!supportsThinking) return null;

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
    </button>
  );
}
