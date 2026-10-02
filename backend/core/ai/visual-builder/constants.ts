export const START_NODE_ID = "start";
export const END_NODE_ID = "end";

export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equals",
  "less_than",
  "less_than_or_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
  "in",
  "not_in",
  "regex_match",
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const BUILTIN_STATE_KEYS = ["input", "cwd", "os"];
