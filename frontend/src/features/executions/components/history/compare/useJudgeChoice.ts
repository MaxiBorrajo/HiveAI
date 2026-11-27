import { useState } from "react";
import { useModels } from "@/features/models/ModelsContext";
import {
  currentChoice,
  type ModelChoice,
} from "@/features/models/lib/modelChoices";

const judgeStorageKey = (executionId: string) => `hiveai.judge.${executionId}`;

function loadJudge(executionId: string): ModelChoice | null {
  try {
    const raw = localStorage.getItem(judgeStorageKey(executionId));
    return raw ? (JSON.parse(raw) as ModelChoice) : null;
  } catch {
    return null;
  }
}

function rememberJudge(executionId: string, choice: ModelChoice) {
  try {
    localStorage.setItem(judgeStorageKey(executionId), JSON.stringify(choice));
  } catch {
    // The choice just isn't remembered.
  }
}

/**
 * The model that grades runs: the one picked for this execution, or the model
 * the user already has selected until they pick another.
 */
export function useJudgeChoice(executionId: string) {
  const { current } = useModels();
  const [picked, setPicked] = useState<ModelChoice | null>(() =>
    loadJudge(executionId),
  );
  const judge = picked ?? (current.model ? currentChoice(current) : null);
  const pick = (choice: ModelChoice) => {
    setPicked(choice);
    rememberJudge(executionId, choice);
  };
  return [judge, pick] as const;
}
