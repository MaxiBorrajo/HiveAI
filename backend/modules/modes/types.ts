export interface ChatMode {
  name: string;
  description: string;
  isCurrent: boolean;
  parameters?: {
    name: string;
    description: string;
    type: "string" | "number" | "boolean";
    defaultValue: string | number | boolean;
    currentValue?: string | number | boolean;
    options?: string[] | number[] | boolean[];
    minValue?: number;
    maxValue?: number;
    note?: string;
    requiresReload: boolean;
  }[];
}
