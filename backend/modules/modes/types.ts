export interface ChatMode {
  name: string;
  description: string;
  isCurrent: boolean;
  parameters?: ChatModeParameter[];
}

export interface ChatModeParameter {
    name: string;
    description: string;
    type: "string" | "number" | "boolean";
    defaultValue: string | number | boolean | null;
    currentValue?: string | number | boolean | null;
    options?: string[] | number[] | boolean[];
    minValue?: number;
    maxValue?: number | null;
    note?: string;
    requiresServiceRestart: boolean;
  }