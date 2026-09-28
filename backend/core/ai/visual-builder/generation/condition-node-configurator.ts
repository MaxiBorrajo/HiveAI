import { ChatOllama } from "@langchain/ollama";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { ConditionConfig, GraphNode, LangGraphAbstraction } from "../types.ts";
import { runConfigStep } from "./generation-step.ts";

/**
 * Dynamic Zod schema for configuring a Condition node.
 */
export function buildConditionNodeSchema(availableStateKeys: string[]) {
  const validKeys = availableStateKeys.filter((k) => k && k.trim().length > 0);
  const fieldSchema =
    validKeys.length > 0
      ? z
          .enum(validKeys as [string, ...string[]])
          .describe(
            `The state memory variable to check. Must be one of: [${validKeys.join(", ")}]`,
          )
      : z
          .string()
          .describe(
            "The exact state memory variable to check (e.g. 'is_valid', 'is_approved', 'is_anomaly')",
          );

  return z.object({
    nodeId: z
      .string()
      .describe("Unique lowercase alphanumeric ID for this condition node"),
    nodeName: z
      .string()
      .describe("Human readable name (e.g. Is Anomaly Detected?)"),
    condition: z
      .object({
        field: fieldSchema,
        operator: z
          .enum([
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
          ])
          .describe("Comparison operator"),
        value: z
          .any()
          .describe(
            "The static value to compare against (e.g. true, false, 'approved', 7)",
          ),
      })
      .describe("The exact logic rule for the True path."),
  });
}

export interface ConditionNodeConfiguratorContext {
  prompt: string;
  configLlm: ChatOllama;
  graph: LangGraphAbstraction;
  graphStateText: string;
}

/**
 * Phase 2, "condition" node branch: configures the condition rule
 * (field/operator/value) via a structured-output call, remapping the field
 * to the actual upstream outputKey and normalizing the value's type against
 * the field's declared/inferred type, falling back to a boolean is_*
 * heuristic if the call fails. Returns whether the fallback path was used
 * (the caller yields "node_updated" without `stateProperties` in that case,
 * matching the pre-refactor behavior).
 */
export async function configureConditionNode(
  node: GraphNode,
  ctx: ConditionNodeConfiguratorContext,
): Promise<{ usedFallback: boolean }> {
  const { prompt, configLlm, graph, graphStateText } = ctx;

  // Find what node feeds into this condition
  const incomingEdges = graph.edges.filter((e) => e.target === node.id);
  const incomingNodes = incomingEdges.map((e) =>
    graph.nodes.find((n) => n.id === e.source),
  );

  const currentKeys = Object.keys(graph.stateSchema);
  const conditionNodeSchema = buildConditionNodeSchema(currentKeys);
  const conditionAgent = configLlm.withStructuredOutput(
    conditionNodeSchema,
    {
      name: "ConditionConfig",
    },
  );

  const builderMessages = [
    new SystemMessage(`You are a Condition Node Configurator.
Node Name: "${node.name}" (ID: "${node.id}")
Incoming nodes: ${incomingNodes.map((n) => `[${n?.type}] ${n?.name}`).join(", ")}
${graphStateText}

Define the condition rule (field, operator, value) for the TRUE path.
Select the 'field' from the available state variables.
CRITICAL TYPING & FIELD SELECTION RULES:
- If the incoming node is a tool execution, command, script, or verification check:
  * The state variable contains the execution output text (e.g. 'check_output', 'verification_result').
  * To check for successful verification / passing: check that the output does NOT contain error indicators:
    field: '<preceding_node_output_key>', operator: 'not_contains', value: 'error' (or 'exit code')
  * NEVER use generic dummy keys like 'result' if a specific outputKey from the preceding node exists in State! Use the preceding node's exact outputKey!
- If the state variable is numeric (e.g. score, rating, count, attempts, percentage): use numeric operators ('greater_than', 'greater_than_or_equals', 'less_than', 'less_than_or_equals') and numeric values (e.g. 5, 80).
- If the state variable is categorical (e.g. category, status, severity): use 'equals' or 'not_equals' and string values (e.g. 'critical', 'passed', 'security').
- If the state variable is boolean (e.g. is_approved, is_valid, is_critical): use operator 'equals' and boolean value true or false (NOT string 'ok' or 'true').
- If checking collections or substrings: use 'contains', 'starts_with', or 'ends_with'.`),
    new HumanMessage(
      `Overall User Objective: "${prompt}"\nConfigure the condition rule.`,
    ),
  ];

  return runConfigStep<z.infer<typeof conditionNodeSchema>, { usedFallback: boolean }>({
    label: "Condition Node Configurator",
    agent: conditionAgent,
    messages: builderMessages,
    onSuccess: (config) => {
      let condField = config.condition.field;
      const incomingNode = incomingNodes[0];
      const incomingOutKey = incomingNode?.config?.outputKey as string | undefined;
      const incomingIsLlm = incomingNode?.type === "llm";

      // Always remap to the actual outputKey of an upstream LLM node:
      // the LLM configurator already set the field's type in stateSchema, so we trust that.
      if (incomingIsLlm && incomingOutKey && condField !== incomingOutKey) {
        condField = incomingOutKey;
      } else if ((condField === "result" || !graph.stateSchema[condField]) && incomingOutKey) {
        // Fallback: remap generic or unknown fields for any node type
        condField = incomingOutKey;
      }

      let condOperator = config.condition.operator;
      let typedVal: unknown = config.condition.value;

      // Adapt tool/plugin check conditions: execution outputs are text strings, not boolean "true"
      if (
        incomingNode?.type === "plugin" &&
        condOperator === "equals" &&
        (String(typedVal).toLowerCase() === "true" ||
          String(typedVal).toLowerCase() === "ok" ||
          String(typedVal).toLowerCase() === "pass" ||
          String(typedVal).toLowerCase() === "success")
      ) {
        console.log(`[Visual Builder - Generator] Adapting tool verification condition for ${node.id}: not_contains "error"`);
        condOperator = "not_contains";
        typedVal = "error";
      }

      const fieldDef = graph.stateSchema[condField];

      const isNumericOp = [
        "greater_than",
        "greater_than_or_equals",
        "less_than",
        "less_than_or_equals",
      ].includes(condOperator);

      if (fieldDef?.type === "number" || isNumericOp) {
        typedVal = Number(typedVal);
        if (fieldDef) fieldDef.type = "number";
      } else if (
        fieldDef?.type === "boolean" ||
        condField.startsWith("is_") ||
        condField.endsWith("_valid") ||
        condField.endsWith("_approved") ||
        condField.endsWith("_anomaly")
      ) {
        if (typeof typedVal === "string") {
          const low = typedVal.toLowerCase().trim();
          typedVal = low === "true" || low === "ok" || low === "yes" || low === "pass" || low === "valid" || low === "anomaly" || low === "critical";
        } else {
          typedVal = Boolean(typedVal);
        }
        if (fieldDef) fieldDef.type = "boolean";
      } else {
        typedVal = String(typedVal);
      }

      const conditionConfig: ConditionConfig = {
        field: condField,
        operator: condOperator,
        value: typedVal,
      };
      node.config = { condition: conditionConfig };

      if (!graph.stateSchema[condField]) {
        graph.stateSchema[condField] = {
          type:
            typeof typedVal === "number"
              ? "number"
              : typeof typedVal === "boolean"
                ? "boolean"
                : "string",
          description: `Decision metric for ${node.name}`,
          required: false,
        };
      }
      return { usedFallback: false };
    },
    onFallback: (err: any) => {
      console.warn(
        `[Visual Builder - Generator] Condition Config failed for ${node.id}:`,
        err?.message,
      );
      const boolField = currentKeys.find(
        (k) => k.startsWith("is_") || graph.stateSchema[k]?.type === "boolean",
      ) || "is_approved";

      const conditionConfig: ConditionConfig = {
        field: boolField,
        operator: "equals",
        value: true,
      };
      node.config = { condition: conditionConfig };
      return { usedFallback: true };
    },
  });
}
