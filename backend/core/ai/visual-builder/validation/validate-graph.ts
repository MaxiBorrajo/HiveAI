import {
  GraphEdge,
  GraphNode,
  InputMappingViolation,
  LangGraphAbstraction,
  PluginParameterInfo,
  ViolationKind,
} from "../types.ts";
import { CONDITION_OPERATORS, END_NODE_ID, START_NODE_ID } from "../constants.ts";
import {
  validateInterpolationValue,
  validateGraphAgentToolMentions,
  validateGraphInterpolationGrammar,
  validateGraphPluginParameters,
  validateGraphVariableReferences,
} from "../generation/validation.ts";
import {
  findConvergingConditionBranches,
  findMissingConditionBranches,
} from "../generation/graph-sanitizer.ts";

const BUILTIN_STATE_KEYS = ["input", "cwd", "os"];

function violation(
  kind: ViolationKind,
  node: Pick<GraphNode, "id" | "name"> | null,
  field: string,
  invalidValue: string,
  reason: string,
  edgeId?: string,
): InputMappingViolation {
  return {
    kind,
    nodeId: node?.id ?? "",
    nodeName: node?.name ?? "graph",
    field,
    invalidValue,
    reason,
    ...(edgeId ? { edgeId } : {}),
  };
}

export function validateGraphStructure(
  graph: LangGraphAbstraction,
): InputMappingViolation[] {
  const violations: InputMappingViolation[] = [];
  const nodeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      violations.push(
        violation(
          "duplicate_node_id",
          node,
          "id",
          node.id,
          `Duplicate node ID found: '${node.id}'. All node IDs must be unique.`,
        ),
      );
    }
    nodeIds.add(node.id);
  }

  for (const type of ["start", "end"] as const) {
    const count = graph.nodes.filter((n) => n.type === type).length;
    if (count !== 1) {
      violations.push(
        violation(
          "invalid_start_end_count",
          null,
          type,
          String(count),
          `The graph must have exactly one node of type '${type}'. Found: ${count}`,
        ),
      );
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    const edgeNode = graph.nodes.find((n) => n.id === edge.source) ?? null;
    if (edgeIds.has(edge.id)) {
      violations.push(
        violation(
          "duplicate_edge_id",
          edgeNode,
          "id",
          edge.id,
          `Duplicate edge ID found: '${edge.id}'. All edge IDs must be unique.`,
          edge.id,
        ),
      );
    }
    edgeIds.add(edge.id);

    for (const end of ["source", "target"] as const) {
      if (!nodeIds.has(edge[end])) {
        violations.push(
          violation(
            "dangling_edge",
            edgeNode,
            end,
            edge[end],
            `Edge '${edge.id}' has a ${end} ("${edge[end]}") that does not exist in the graph.`,
            edge.id,
          ),
        );
      }
    }
  }

  return violations;
}

function validateEdgeRules(graph: LangGraphAbstraction): InputMappingViolation[] {
  const violations: InputMappingViolation[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const edge of graph.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;

    if (edge.source === edge.target) {
      violations.push(
        violation(
          "invalid_edge",
          source,
          "target",
          edge.target,
          `Node "${source.name}" is connected to itself.`,
          edge.id,
        ),
      );
    }
    if (target.type === "start") {
      violations.push(
        violation(
          "invalid_edge",
          target,
          "target",
          target.id,
          `The start node cannot have incoming edges (edge from "${source.name}").`,
          edge.id,
        ),
      );
    }
    if (source.type === "end") {
      violations.push(
        violation(
          "invalid_edge",
          source,
          "source",
          source.id,
          `The end node cannot have outgoing edges (edge to "${target.name}").`,
          edge.id,
        ),
      );
    }
    if (source.type === "condition" && edge.path !== "true" && edge.path !== "false") {
      violations.push(
        violation(
          "condition_edge_missing_path",
          source,
          "path",
          String(edge.path ?? ""),
          `Edge from condition "${source.name}" must have path "true" or "false".`,
          edge.id,
        ),
      );
    }
  }

  return violations;
}

function reachable(
  startId: string,
  adjacency: Map<string, string[]>,
): Set<string> {
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

function validateReachability(graph: LangGraphAbstraction): InputMappingViolation[] {
  const start = graph.nodes.find((n) => n.type === "start");
  const end = graph.nodes.find((n) => n.type === "end");
  if (!start || !end) return [];

  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const edge of graph.edges) {
    forward.set(edge.source, [...(forward.get(edge.source) ?? []), edge.target]);
    backward.set(edge.target, [...(backward.get(edge.target) ?? []), edge.source]);
  }

  const fromStart = reachable(start.id, forward);
  const toEnd = reachable(end.id, backward);
  const violations: InputMappingViolation[] = [];

  for (const node of graph.nodes) {
    if (!fromStart.has(node.id)) {
      violations.push(
        violation(
          "unreachable_node",
          node,
          "id",
          node.id,
          `Node "${node.name}" is not reachable from the start node. Connect it to the flow or remove it.`,
        ),
      );
    }
    if (!toEnd.has(node.id)) {
      violations.push(
        violation(
          "cannot_reach_end",
          node,
          "id",
          node.id,
          `Node "${node.name}" cannot reach the end node. Every path must eventually end.`,
        ),
      );
    }
  }

  return violations;
}

function extractInterpolatedNames(text: string): string[] {
  return [...text.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateNodeConfigs(
  graph: LangGraphAbstraction,
  availablePlugins: PluginParameterInfo[],
): InputMappingViolation[] {
  const violations: InputMappingViolation[] = [];
  const pluginNames = new Set(availablePlugins.map((p) => p.name));
  const outputKeyOwners = new Map<string, GraphNode>();

  for (const node of graph.nodes) {
    const config = (node.config ?? {}) as Record<string, unknown>;

    if (node.type === "llm" || node.type === "plugin") {
      const outputKey = config.outputKey;
      if (!nonEmptyString(outputKey)) {
        violations.push(
          violation(
            "invalid_output_key",
            node,
            "outputKey",
            "",
            `Node "${node.name}" has no outputKey. It must write its result to a state variable.`,
          ),
        );
      } else if (BUILTIN_STATE_KEYS.includes(outputKey)) {
        violations.push(
          violation(
            "invalid_output_key",
            node,
            "outputKey",
            outputKey,
            `"${outputKey}" is a reserved variable and cannot be used as an outputKey.`,
          ),
        );
      } else if (outputKeyOwners.has(outputKey)) {
        violations.push(
          violation(
            "invalid_output_key",
            node,
            "outputKey",
            outputKey,
            `outputKey "${outputKey}" is already written by node "${outputKeyOwners.get(outputKey)!.name}". Each node needs a unique outputKey.`,
          ),
        );
      } else {
        outputKeyOwners.set(outputKey, node);
      }
    }

    if (node.type === "llm") {
      if (!nonEmptyString(config.systemPrompt)) {
        violations.push(
          violation(
            "invalid_node_config",
            node,
            "systemPrompt",
            "",
            `LLM node "${node.name}" has an empty systemPrompt.`,
          ),
        );
      }
      const plugins = Array.isArray(config.plugins) ? config.plugins : [];
      for (const plugin of plugins) {
        if (typeof plugin !== "string" || !pluginNames.has(plugin)) {
          violations.push(
            violation(
              "unknown_plugin",
              node,
              "plugins",
              String(plugin),
              `"${String(plugin)}" is not a registered plugin. Available plugins: [${availablePlugins.map((p) => p.name).join(", ")}].`,
            ),
          );
        }
      }
    }

    if (node.type === "plugin" && !nonEmptyString(config.pluginId)) {
      violations.push(
        violation(
          "invalid_node_config",
          node,
          "pluginId",
          "",
          `Plugin node "${node.name}" has no plugin selected.`,
        ),
      );
    }
  }

  const knownKeys = new Set([
    ...BUILTIN_STATE_KEYS,
    ...outputKeyOwners.keys(),
    ...Object.keys(graph.stateSchema ?? {}),
  ]);

  for (const node of graph.nodes) {
    const config = (node.config ?? {}) as Record<string, any>;

    if (node.type === "llm") {
      if (nonEmptyString(config.systemPrompt)) {
        const syntaxError = validateInterpolationValue(config.systemPrompt);
        if (syntaxError) {
          violations.push(
            violation(
              "syntax",
              node,
              "systemPrompt",
              config.systemPrompt,
              syntaxError,
            ),
          );
        } else {
          for (const name of extractInterpolatedNames(config.systemPrompt)) {
            if (!knownKeys.has(name)) {
              violations.push(
                violation(
                  "undefined_variable",
                  node,
                  "systemPrompt",
                  `\${${name}}`,
                  `"\${${name}}" in the system prompt references a variable that no node produces.`,
                ),
              );
            }
          }
        }
      }
    }

    if (node.type === "condition") {
      const cond = config.condition;
      if (!cond || !nonEmptyString(cond.field)) {
        violations.push(
          violation(
            "invalid_node_config",
            node,
            "condition.field",
            "",
            `Condition node "${node.name}" has no field to evaluate.`,
          ),
        );
        continue;
      }
      const root = String(cond.field).split(/[.[]/)[0];
      if (!knownKeys.has(root)) {
        violations.push(
          violation(
            "undefined_variable",
            node,
            "condition.field",
            String(cond.field),
            `Condition field "${cond.field}" references a variable that no node produces.`,
          ),
        );
      }
      if (!(CONDITION_OPERATORS as readonly string[]).includes(cond.operator)) {
        violations.push(
          violation(
            "invalid_node_config",
            node,
            "condition.operator",
            String(cond.operator ?? ""),
            `Condition node "${node.name}" has an invalid operator. Valid operators: [${CONDITION_OPERATORS.join(", ")}].`,
          ),
        );
      }
    }

    if (node.type === "end") {
      const output = config.output;
      if (!output || !nonEmptyString(output.type)) {
        violations.push(
          violation(
            "invalid_node_config",
            node,
            "output.type",
            "",
            `End node "${node.name}" must define the output type of the result.`,
          ),
        );
      } else if (
        !nonEmptyString(output.contentKey) &&
        !(Array.isArray(output.files) && output.files.length > 0)
      ) {
        violations.push(
          violation(
            "invalid_node_config",
            node,
            "output.contentKey",
            "",
            `End node "${node.name}" does not say which variable holds the result. Choose the result variable that this workflow delivers.`,
          ),
        );
      } else if (
        nonEmptyString(output.contentKey) && !knownKeys.has(output.contentKey)
      ) {
        violations.push(
          violation(
            "undefined_variable",
            node,
            "output.contentKey",
            output.contentKey,
            `End node output.contentKey "${output.contentKey}" references a variable that no node produces.`,
          ),
        );
      }
    }
  }

  return violations;
}

export function validateGraphInputMappings(
  graph: LangGraphAbstraction,
  availablePlugins: PluginParameterInfo[],
): InputMappingViolation[] {
  return [
    ...validateGraphInterpolationGrammar(graph),
    ...validateGraphVariableReferences(graph),
    ...validateGraphPluginParameters(graph, availablePlugins),
    ...validateGraphAgentToolMentions(graph, availablePlugins),
  ];
}

export function validateGraph(
  graph: LangGraphAbstraction,
  availablePlugins: PluginParameterInfo[],
): InputMappingViolation[] {
  const structural = validateGraphStructure(graph);
  if (structural.length > 0) return structural;

  const intermediate = graph.nodes.filter(
    (n) => n.id !== START_NODE_ID && n.id !== END_NODE_ID,
  );

  return [
    ...validateEdgeRules(graph),
    ...validateReachability(graph),
    ...validateNodeConfigs(graph, availablePlugins),
    ...validateGraphInputMappings(graph, availablePlugins),
    ...findMissingConditionBranches(intermediate, graph.edges as GraphEdge[]),
    ...findConvergingConditionBranches(intermediate, graph.edges as GraphEdge[]),
  ];
}
