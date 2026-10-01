import { CONDITION_OPERATORS } from "../condition-operators.ts";
import { z } from "zod";

export const statePropertyDefinitionSchema = z.object({
  type: z.enum(["string", "number", "boolean", "object", "array"]),
  description: z.string().optional(),
  default: z.any().optional(),
  required: z.boolean().default(false),
  reducerStrategy: z
    .enum(["overwrite", "append", "merge_dict", "sum"])
    .optional(),
});

export const edgeConditionSchema = z
  .object({
    field: z.string().describe("State property to evaluate"),
    operator: z.enum(CONDITION_OPERATORS),
    value: z.unknown(),
  })
  .describe("Condition required to traverse the edge.");
