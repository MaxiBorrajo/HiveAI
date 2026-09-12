import type { ReactElement } from "react";

export interface ChatStep {
  node:
    | "Solver"
    | "AbstentionVerificator"
    | "Executor"
    | "Diagnostician"
    | "HiveQueenResponder"
    | "Plugin"
    | "Agent";
  label: string;
  durationMs: number;
  summary: string;
}

export interface ThinkingRun {
  node: string | undefined;
  text: string;
}

export interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  isError?: boolean;
  timestamp: number;
  usedTools?: string[];
  steps?: ChatStep[];
  thinkingRuns?: ThinkingRun[];
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface StoredMessage {
  id: string;
  chatId: string;
  role: "user" | "agent";
  content: string;
  timestamp: number;
  metadata: {
    usedTools: string[];
    steps: ChatStep[];
    thinkingRuns?: ThinkingRun[];
  } | null;
}

export interface ChatMode {
  name: string;
  description: string;
  icon: ReactElement;
  isCurrent?: boolean;
  parameters?: ChatModeParameter[];
  performanceNote?: string;
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
