import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  choiceValue,
  parseChoiceValue,
  sameChoice,
  type ModelChoice,
} from "@/features/models/lib/modelChoices";
import { suggestModels } from "../api/discovery";
import type { SuggestResult } from "../types";

export interface AdvisorChoice {
  choice: ModelChoice;
  label: string;
  group: string;
}

interface ModelAdvisorBarProps {
  /** Models the user can ask (installed and cloud with a key) */
  choices: AdvisorChoice[];
  /** Asked unless the user picks another: normally the model in use */
  defaultChoice: ModelChoice | null;
  onResult: (query: string, result: SuggestResult) => void;
}

const STORAGE_KEY = "hiveai.modelAdvisor";

function loadChoice(): ModelChoice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ModelChoice) : null;
  } catch {
    return null;
  }
}

/**
 * "Ask a model which model to use": the answer is not shown as text, it becomes
 * the list of models below (see ModelSearch).
 */
export function ModelAdvisorBar({ choices, defaultChoice, onResult }: ModelAdvisorBarProps) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ModelChoice | null>(loadChoice);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = (c: ModelChoice | null) => !!c && choices.some((x) => sameChoice(x.choice, c));
  const selected = available(picked) ? picked : available(defaultChoice) ? defaultChoice : choices[0]?.choice ?? null;

  const groups = [...new Set(choices.map((c) => c.group))];

  function pick(value: string) {
    const choice = parseChoiceValue(value);
    if (!choice) return;
    setPicked(choice);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } catch {
      // the choice just isn't remembered
    }
  }

  async function ask() {
    const text = query.trim();
    if (!text || !selected || asking) return;
    setAsking(true);
    setError(null);
    try {
      const response = await suggestModels(text, selected);
      if (response.success && response.data) onResult(text, response.data);
      else setError(response.errors?.[0] ?? "Could not get suggestions.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not get suggestions.");
    } finally {
      setAsking(false);
    }
  }

  if (choices.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card/50 p-2" data-testid="model-advisor">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Sparkles
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            className="pl-8"
            placeholder="Describe what you need, e.g. a good model for coding that fits my PC"
            aria-label="Describe what you need"
            data-testid="model-advisor-input"
            maxLength={500}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
          />
        </div>
        <Button
          size="sm"
          onClick={ask}
          disabled={!query.trim() || !selected || asking}
          data-testid="model-advisor-submit"
        >
          {asking ? "Asking…" : "Suggest"}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Ask
        <select
          value={selected ? choiceValue(selected) : ""}
          onChange={(e) => pick(e.target.value)}
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="model-advisor-model"
          aria-label="Model to ask"
        >
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {choices.filter((c) => c.group === group).map((c) => (
                <option key={choiceValue(c.choice)} value={choiceValue(c.choice)}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {error && (
        <p className="text-xs text-destructive" data-testid="model-advisor-error">
          {error}
        </p>
      )}
    </div>
  );
}
