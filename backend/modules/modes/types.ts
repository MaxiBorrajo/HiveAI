export interface ChatMode {
  name: string;
  description: string;
  parameters?: {
    name: string;
    description: string;
    type: "string" | "number" | "boolean";
    defaultValue: string | number | boolean;
    currentValue?: string | number | boolean;
    options?: string[] | number[] | boolean[];
    minValue?: number;
    maxValue?: number;
    requiresReload: boolean;
  }[];
}
