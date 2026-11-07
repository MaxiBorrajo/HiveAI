import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useModels } from "@/features/models/ModelsContext";
import {
  canUse,
  choiceValue,
  PROVIDER_LABELS,
  parseChoiceValue,
  toChoice,
  type ModelChoice,
} from "@/features/models/lib/modelChoices";

interface JudgeOption {
  value: string;
  label: string;
}

/** Any local or cloud model the judge agent can use, with its tools. */
export function JudgeModelSelect({
  value,
  onChange,
  disabled,
}: {
  value: ModelChoice | null;
  onChange: (choice: ModelChoice) => void;
  disabled?: boolean;
}) {
  const { optionGroups } = useModels();
  const options = useMemo<JudgeOption[]>(
    () =>
      optionGroups.flatMap((group) =>
        group.options
          .filter((option) => canUse(option.toolSupport))
          .map((option) => ({
            value: choiceValue(toChoice(option)),
            label: `${PROVIDER_LABELS[option.ref.provider]} · ${option.ref.model}${
              group.keyAlias ? ` (${group.keyAlias})` : ""
            }`,
          })),
      ),
    [optionGroups],
  );

  return (
    <Select
      value={value ? choiceValue(value) : null}
      onValueChange={(v) => {
        const choice = parseChoiceValue(String(v));
        if (choice) onChange(choice);
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label="Judge model">
        <SelectValue placeholder="Pick the judge model">
          {(v: string | null) =>
            options.find((o) => o.value === v)?.label ?? "Pick the judge model"
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
