import type { ReactElement } from "react";

export interface ChatStep {
  node: "Solver" | "AbstentionVerificator" | "Executor" | "Diagnostician" | "HiveQueenResponder" | "Plugin";
  label: string;
  durationMs: number;
  summary: string;
}

// One contiguous burst of "thinking" text from a single node. A node that
// runs more than once in the same turn (e.g. Executor retried after
// Diagnostician) produces multiple runs, one per occurrence — matched to
// `steps` by order of appearance, the same way `steps` itself accumulates
// one entry per node execution rather than merging repeats.
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
