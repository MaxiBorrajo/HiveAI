import type { ReactElement } from "react";

export interface ChatStep {
  node: "Selector" | "Executor" | "HiveQueen" | "Plugin";
  label: string;
  durationMs: number;
  summary: string;
}

export interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  isError?: boolean;
  timestamp: number;
  usedTools?: string[];
  steps?: ChatStep[];
}

export interface ChatMode {
  name: string;
  description: string;
  icon: ReactElement;
  isCurrent?: boolean;
  parameters?: ChatModeParameter[];
}

export interface ChatModeParameter {
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
  }