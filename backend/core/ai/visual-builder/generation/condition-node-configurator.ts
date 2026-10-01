import { stateKeySchema } from "./shared.ts";
import { CONDITION_OPERATORS } from "../condition-operators.ts";
import { ChatOllama } from "@langchain/ollama";
import { AIMessage, BaseMessage, SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { ConditionConfig, ConditionNodeConfiguratorContext, ConditionOperator, GraphNode, LangGraphAbstraction } from "../types.ts";
import { runConfigStep } from "./generation-step.ts";

const MAX_CONDITION_RETRIES = 1;

type ConditionCandidate = { field: string; operator: ConditionOperator; value: unknown };

// Checks the LLM's chosen field/operator/value against what we actually know
// about the graph, instead of silently rewriting a wrong answer. Any
// violation found here is sent back to the LLM as feedback for a retry — the
// deterministic rewrite is only applied as a true last resort, once retries
// are exhausted (see configureConditionNode).
function validateConditionCandidate(
  candidate: ConditionCandidate,
  incomingNode: GraphNode | undefined,
  graph: LangGraphAbstraction,
): string[] {
  const violations: string[] = [];
  const incomingOutKey = incomingNode?.config?.outputKey as string | undefined;
  const incomingIsLlm = incomingNode?.type === "llm";

  if (incomingIsLlm && incomingOutKey && candidate.field !== incomingOutKey) {
    violations.push(
      `field "${candidate.field}" does not match the immediate predecessor's real outputKey "${incomingOutKey}". Use "${incomingOutKey}" instead of inventing a different field name.`,
    );
  } else if (
    (candidate.field === "result" || !graph.stateSchema[candidate.field]) &&
    incomingOutKey
  ) {
    violations.push(
      `field "${candidate.field}" is not a real state variable (available: [${Object.keys(graph.stateSchema).join(", ")}]). Use the predecessor's real outputKey "${incomingOutKey}" instead.`,
    );
  }

  if (
    incomingNode?.type === "plugin" &&
    candidate.operator === "equals" &&
    ["true", "ok", "pass", "success"].includes(
      String(candidate.value).toLowerCase(),
    )
  ) {
    violations.push(
      `operator "equals" with value "${candidate.value}" cannot match a plugin node's raw text output. Use operator "not_contains" with value "error" instead (plugin outputs are execution text, not a literal boolean).`,
    );
  }

  return violations;
}

export function buildConditionNodeSchema(availableStateKeys: string[]) {
  const fieldSchema = stateKeySchema(
    availableStateKeys,
    "The state memory variable to check. Must be one of:",
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
        operator: z.enum(CONDITION_OPERATORS)
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

function getIncomingNodes(graph: LangGraphAbstraction, nodeId: string): (GraphNode | undefined)[] {
  return graph.edges
    .filter((e) => e.target === nodeId)
    .map((e) => graph.nodes.find((n) => n.id === e.source));
}

function buildConditionSystemPrompt(
  node: GraphNode,
  incomingNodes: (GraphNode | undefined)[],
  graphStateText: string,
): string {
  return `You are a Condition Node Configurator.
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
      - If checking collections or substrings: use 'contains', 'starts_with', or 'ends_with'.`;
}


async function requestConditionCandidate(
  node: GraphNode,
  conditionAgent: ReturnType<ChatOllama["withStructuredOutput"]>,
  messages: BaseMessage[],
  incomingNode: GraphNode | undefined,
  graph: LangGraphAbstraction,
): Promise<{ candidate: ConditionCandidate | null; usedFallback: boolean }> {
  for (let attempt = 1; attempt <= MAX_CONDITION_RETRIES + 1; attempt++) {
    const step = await runConfigStep<
      { condition: ConditionCandidate },
      { config: { condition: ConditionCandidate } | null; failed: boolean }
    >({
      label: "Condition Node Configurator",
      agent: conditionAgent,
      messages,
      onSuccess: (config) => ({ config, failed: false }),
      onFallback: (err: unknown) => {
        console.warn(
          `[Visual Builder - Generator] Condition Config LLM call failed for ${node.id} (attempt ${attempt}):`,
          err instanceof Error ? err.message : err,
        );
        return { config: null, failed: true };
      },
    });

    if (step.failed || !step.config) return { candidate: null, usedFallback: true };

    const violations = validateConditionCandidate(step.config.condition, incomingNode, graph);
    if (violations.length === 0) {
      return { candidate: step.config.condition, usedFallback: false };
    }

    console.warn(
      `[Visual Builder - Generator] Condition node ${node.id} attempt ${attempt} produced an invalid condition:`,
      violations,
    );

    if (attempt > MAX_CONDITION_RETRIES) {
      return { candidate: step.config.condition, usedFallback: true };
    }

    messages.push(
      new AIMessage(JSON.stringify(step.config)),
      new HumanMessage(
        `That condition is invalid:\n${violations.map((v) => `- ${v}`).join("\n")}\nFix ALL of the issues above and answer again with a corrected condition.`,
      ),
    );
  }

  return { candidate: null, usedFallback: true };
}

function buildEmergencyCondition(
  currentKeys: string[],
  graph: LangGraphAbstraction,
): ConditionConfig {
  const boolField =
    currentKeys.find(
      (k) => k.startsWith("is_") || graph.stateSchema[k]?.type === "boolean",
    ) || "is_approved";

  return { field: boolField, operator: "equals", value: true };
}

function normalizeConditionCandidate(
  candidate: ConditionCandidate,
  incomingNode: GraphNode | undefined,
  graph: LangGraphAbstraction,
): ConditionConfig {
  let condField = candidate.field;
  const incomingOutKey = incomingNode?.config?.outputKey as string | undefined;
  const incomingIsLlm = incomingNode?.type === "llm";
  if (incomingIsLlm && incomingOutKey && condField !== incomingOutKey) {
    condField = incomingOutKey;
  } else if ((condField === "result" || !graph.stateSchema[condField]) && incomingOutKey) {
    condField = incomingOutKey;
  }

  let condOperator = candidate.operator;
  let typedVal: unknown = candidate.value;

  if (
    incomingNode?.type === "plugin" &&
    condOperator === "equals" &&
    ["true", "ok", "pass", "success"].includes(String(typedVal).toLowerCase())
  ) {
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
      typedVal = ["true", "ok", "yes", "pass", "valid", "anomaly", "critical"].includes(low);
    } else {
      typedVal = Boolean(typedVal);
    }
    if (fieldDef) fieldDef.type = "boolean";
  } else {
    typedVal = String(typedVal);
  }

  return { field: condField, operator: condOperator, value: typedVal };
}

function registerConditionStateField(
  graph: LangGraphAbstraction,
  node: GraphNode,
  conditionConfig: ConditionConfig,
): void {
  if (graph.stateSchema[conditionConfig.field]) return;

  graph.stateSchema[conditionConfig.field] = {
    type:
      typeof conditionConfig.value === "number"
        ? "number"
        : typeof conditionConfig.value === "boolean"
          ? "boolean"
          : "string",
    description: `Decision metric for ${node.name}`,
    required: false,
  };
}

export async function configureConditionNode(
  node: GraphNode,
  ctx: ConditionNodeConfiguratorContext,
): Promise<{ usedFallback: boolean }> {
  const { prompt, configLlm, graph, graphStateText } = ctx;

  const incomingNodes = getIncomingNodes(graph, node.id);
  const incomingNode = incomingNodes[0];

  const currentKeys = Object.keys(graph.stateSchema);
  const conditionNodeSchema = buildConditionNodeSchema(currentKeys);
  const conditionAgent = configLlm.withStructuredOutput(conditionNodeSchema, {
    name: "ConditionConfig",
  });

  const messages: BaseMessage[] = [
    new SystemMessage(buildConditionSystemPrompt(node, incomingNodes, graphStateText)),
    new HumanMessage(
      `Overall User Objective: "${prompt}"\nConfigure the condition rule.`,
    ),
  ];

  const { candidate, usedFallback } = await requestConditionCandidate(
    node,
    conditionAgent,
    messages,
    incomingNode,
    graph,
  );

  if (!candidate) {
    node.config = { condition: buildEmergencyCondition(currentKeys, graph) };
    return { usedFallback: true };
  }

  const conditionConfig = normalizeConditionCandidate(candidate, incomingNode, graph);
  node.config = { condition: conditionConfig };
  registerConditionStateField(graph, node, conditionConfig);

  return { usedFallback };
}
