import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useModels } from "@/features/models/ModelsContext";
import { formatCostEstimate } from "@/features/models/api/getModelRecommendations";
import type { ModelChoice } from "@/features/models/lib/modelChoices";
import type { ModelSuggestion } from "../types.ts";

/**
 * Under an answer: "looks like you are doing X, these models may do better".
 * Only a suggestion: nothing changes until the user clicks a model.
 */
export function ModelSuggestionFooter({ suggestion }: { suggestion: ModelSuggestion }) {
  const { changeModel } = useModels();
  const [switching, setSwitching] = useState<string | null>(null);

  const { recommendations, suggestions } = suggestion;
  if (recommendations.length === 0 && suggestions.length === 0) return null;

  async function pick(id: string, choice: ModelChoice) {
    setSwitching(id);
    try {
      await changeModel(choice);
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div
      className="mt-3 rounded-md border border-border bg-muted/30 p-2.5"
      data-testid="model-suggestion"
    >
      <p className="text-xs text-muted-foreground">
        Looks like you&apos;re working on{" "}
        <strong className="text-foreground" data-testid="model-suggestion-task">
          {suggestion.taskLabel.toLowerCase()}
        </strong>
        .{" "}
        {recommendations.length > 0
          ? "These models may do better:"
          : "None of your models is a good fit for it."}
      </p>

      {recommendations.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {recommendations.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={switching !== null}
                onClick={() =>
                  pick(r.id, {
                    provider: r.ref.provider,
                    model: r.ref.model,
                    keyId: r.ref.keyId ?? "",
                  })
                }
                className="flex w-full flex-col gap-0.5 rounded-md border border-border bg-background px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                title="Switch to this model"
                data-testid={`model-suggestion-item-${r.id}`}
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs">{r.label}</span>
                  <Badge variant={r.location === "local" ? "secondary" : "outline"} data-testid="model-suggestion-location">
                    {r.location === "local" ? "Local" : "Cloud"}
                  </Badge>
                  {r.location === "cloud" && (
                    <span className="text-[11px] text-muted-foreground" data-testid="model-suggestion-cost">
                      {formatCostEstimate(r.estimatedCostUsd)}
                    </span>
                  )}
                  {switching === r.id && (
                    <span className="text-[11px] text-muted-foreground">Switching…</span>
                  )}
                </span>
                <span className="text-[11px] text-muted-foreground">{r.reason}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {suggestions.map((s) => (
        <p
          key={s.kind}
          className="mt-2 text-[11px] text-muted-foreground"
          data-testid={`model-suggestion-${s.kind}`}
        >
          <strong className="text-foreground">
            {s.kind === "install" ? `Install ${s.model}` : `Set up ${s.model}`}
          </strong>
          {" — "}
          {s.reason}
        </p>
      ))}
    </div>
  );
}
