import { ChatOllama } from "@langchain/ollama";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  GraphNode,
  IncrementalEvent,
  InputMappingViolation,
  InterpolationSelfCorrectionContext,
  LangGraphAbstraction,
} from "../types.ts";
import {
  validateGraphInterpolationGrammar,
  validateGraphVariableReferences,
  validateGraphPluginParameters,
  validateGraphAgentToolMentions,
} from "../validation.ts";
import { runConfigStep } from "./generation-step.ts";
import { buildPluginConfigSchema } from "./plugin-node-configurator.ts";
import { PluginInfo } from "./topology-compiler.ts";

const MAX_GRAMMAR_RETRIES = 1;

function runValidationPass(
  graph: LangGraphAbstraction,
  availablePlugins: PluginInfo[],
): InputMappingViolation[] {
  return [
    ...validateGraphInterpolationGrammar(graph),
    ...validateGraphVariableReferences(graph),
    ...validateGraphPluginParameters(graph, availablePlugins),
    ...validateGraphAgentToolMentions(graph, availablePlugins),
  ];
}

function extractMentionedToolName(reason: string): string | undefined {
  return reason.match(/mentions using the "([^"]+)" tool/)?.[1];
}

function equipMissingTools(
  node: GraphNode,
  toolMentionViolations: InputMappingViolation[],
): boolean {
  const existingPlugins = Array.isArray(node.config?.plugins)
    ? (node.config.plugins as string[])
    : [];
  const missingPlugins = toolMentionViolations
    .map((v) => extractMentionedToolName(v.reason))
    .filter((p): p is string => Boolean(p) && !existingPlugins.includes(p!));

  if (missingPlugins.length === 0) return false;

  node.config = {
    ...node.config,
    plugins: [...existingPlugins, ...missingPlugins],
  };
  return true;
}


function stripOrRewriteFieldReference(
  mapping: Record<string, any>,
  violation: InputMappingViolation,
  graph: LangGraphAbstraction,
  node: GraphNode,
): void {
  const incomingEdge = graph.edges.find((e) => e.target === node.id);
  const predecessor = incomingEdge
    ? graph.nodes.find((n) => n.id === incomingEdge.source)
    : undefined;
  const predecessorOutKey = predecessor?.config?.outputKey as string | undefined;

  if (predecessorOutKey && typeof mapping[violation.field] === "string") {
    mapping[violation.field] = mapping[violation.field].replace(
      /\$\{[^}]*\}/g,
      `\${${predecessorOutKey}}`,
    );
  }
}

function applyDeterministicFallback(
  graph: LangGraphAbstraction,
  violations: InputMappingViolation[],
): void {
  console.warn(
    `[Visual Builder - Generator] Max grammar retries exceeded; applying deterministic strip-to-bare-var fallback.`,
  );

  for (const v of violations) {
    const node = graph.nodes.find((n) => n.id === v.nodeId);
    if (!node) continue;

    if (v.kind === "unequipped_tool_mention") {
      equipMissingTools(node, [v]);
      continue;
    }

    const mapping = { ...((node.config as any).inputMapping || {}) } as Record<
      string,
      any
    >;
    stripOrRewriteFieldReference(mapping, v, graph, node);
    node.config = { ...node.config, inputMapping: mapping };
  }
}

function groupViolationsByNode(
  violations: InputMappingViolation[],
): Map<string, InputMappingViolation[]> {
  const byNode = new Map<string, InputMappingViolation[]>();
  for (const v of violations) {
    if (!byNode.has(v.nodeId)) byNode.set(v.nodeId, []);
    byNode.get(v.nodeId)!.push(v);
  }
  return byNode;
}

function buildGraphStateText(graph: LangGraphAbstraction): string {
  return `Current Memory Variables (State):
${Object.entries(graph.stateSchema)
  .map(([k, v]) => `  - ${k} (${(v as any).type})`)
  .join("\n")}`;
}

async function* correctPluginInputMapping(
  node: GraphNode,
  nodeViolations: InputMappingViolation[],
  ctx: {
    availablePlugins: PluginInfo[];
    configLlm: ChatOllama;
    graph: LangGraphAbstraction;
    nodeDescriptions: Map<string, string>;
    graphStateText: string;
  },
): AsyncGenerator<IncrementalEvent, void, unknown> {
  const {
    availablePlugins,
    configLlm,
    graph,
    nodeDescriptions,
    graphStateText,
  } = ctx;

  const pluginId = (node.config as any)?.pluginId as string;
  const pluginDef = availablePlugins.find((p) => p.name === pluginId);
  if (!pluginDef) {
    throw new Error(
      `Node "${node.name}" (${node.id}) has pluginId "${pluginId}", which is not a registered plugin. Available plugins: [${availablePlugins.map((p) => p.name).join(", ")}].`,
    );
  }
  const nodeRole = nodeDescriptions.get(node.id) || node.name;

  const pluginConfigSchema = buildPluginConfigSchema(
    availablePlugins,
    pluginDef,
  );
  const pluginAgent = configLlm.withStructuredOutput(pluginConfigSchema, {
    name: "PluginConfig",
  });

  const correctionMessages = [
    new SystemMessage(`You are a Plugin Node Configurator fixing an INVALID inputMapping.
    Node Name: "${node.name}" (ID: "${node.id}")
    Node Operational Role: "${nodeRole}"
    Selected Plugin: "${pluginDef.name}"
    Plugin Parameters: ${pluginDef.parametersDescription || "None"}

    The previously generated inputMapping is INVALID:
    ${JSON.stringify((node.config as any).inputMapping)}

    VALIDATION ERRORS (fix ALL of these):
    ${nodeViolations.map((v) => `- Field "${v.field}" = "${v.invalidValue}": ${v.reason}`).join("\n")}

    CRITICAL RULE — INTERPOLATION GRAMMAR:
    - Every value MUST be either a flat literal or contain ONLY bare "\${varName}" references (single identifier, NO dots, NO brackets).
    - "\${search_results}" is valid. "\${search_results.results[0].url}" and "\${search_results[1].url}" are INVALID and FORBIDDEN.
    - If you need one specific field out of a list/object, reference the FULL variable here (e.g. "\${search_results}") — extracting a specific field must happen in an upstream agent/llm node, not in this template string.
    - If an error says a variable is "not produced by any node", that means NO node's outputKey equals that name — this INCLUDES "\${result}", which is only a placeholder and does NOT mean any node wrote to it. Replace it with the EXACT outputKey of the node that actually feeds this one (see the state variables listed below — each corresponds to a real node's outputKey).
    ${graphStateText}`),
        new HumanMessage(
          `Fix the inputMapping for node "${node.name}" so every value obeys the bare-\${varName} grammar. Do not invent dot/bracket paths.`,
        ),
      ];

  const fixedMapping = await runConfigStep<
    z.infer<ReturnType<typeof buildPluginConfigSchema>>,
    Record<string, any> | null
  >({
    label: "Plugin Grammar Self-Correction",
    agent: pluginAgent,
    messages: correctionMessages,
    onSuccess: (corrected) => {
      const rawMapping = (corrected.inputMapping || {}) as Record<string, any>;
      const fixed: Record<string, any> = {};
      for (const [k, v] of Object.entries(rawMapping)) {
        fixed[k] =
          v && typeof v === "object" && "value" in v ? (v as any).value : v;
      }
      return fixed;
    },
    onFallback: (err: any) => {
      console.warn(
        `[Visual Builder - Generator] Grammar self-correction failed for ${node.id}:`,
        err?.message,
      );
      return null;
    },
  });

  if (fixedMapping) {
    node.config = { ...node.config, inputMapping: fixedMapping };
    yield { type: "node_fixed", node, stateProperties: graph.stateSchema };
  }
}

async function* correctViolationsPerNode(
  byNode: Map<string, InputMappingViolation[]>,
  ctx: InterpolationSelfCorrectionContext,
): AsyncGenerator<IncrementalEvent, void, unknown> {
  const { graph, availablePlugins, configLlm, nodeDescriptions } = ctx;
  const graphStateText = buildGraphStateText(graph);

  for (const [nodeId, nodeViolations] of byNode) {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) continue;

    const toolMentionViolations = nodeViolations.filter(
      (v) => v.kind === "unequipped_tool_mention",
    );
    if (toolMentionViolations.length > 0 && node.type === "llm") {
      if (equipMissingTools(node, toolMentionViolations)) {
        yield { type: "node_fixed", node, stateProperties: graph.stateSchema };
      }
    }

    if (node.type !== "plugin") continue;

    yield* correctPluginInputMapping(node, nodeViolations, {
      availablePlugins,
      configLlm,
      graph,
      nodeDescriptions,
      graphStateText,
    });
  }
}

export async function* runInterpolationSelfCorrection(
  ctx: InterpolationSelfCorrectionContext,
): AsyncGenerator<IncrementalEvent, void, unknown> {
  const { graph, availablePlugins } = ctx;

  for (let attempt = 1; attempt <= MAX_GRAMMAR_RETRIES + 1; attempt++) {
    const violations = runValidationPass(graph, availablePlugins);
    if (violations.length === 0) break;

    console.warn(
      `[Visual Builder - Generator] Interpolation grammar violations (attempt ${attempt}):`,
      JSON.stringify(violations),
    );
    yield { type: "validation_error", violations, attempt };

    if (attempt > MAX_GRAMMAR_RETRIES) {
      applyDeterministicFallback(graph, violations);
      break;
    }

    yield* correctViolationsPerNode(groupViolationsByNode(violations), ctx);
  }
}
