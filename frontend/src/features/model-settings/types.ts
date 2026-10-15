export type ModelSettingValue = string | number | boolean | null;

export interface ModelSetting {
  name: string;
  description: string;
  type: "string" | "number" | "boolean";
  defaultValue: ModelSettingValue;
  currentValue: ModelSettingValue;
  options?: string[];
  minValue?: number;
  maxValue?: number;
  step?: number;
  note?: string;
  requiresServiceRestart: boolean;
}
