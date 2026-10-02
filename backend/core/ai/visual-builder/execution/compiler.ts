import { StateGraph, ReducedValue, START, END } from "@langchain/langgraph";
import {
  LangGraphAbstraction,
  GraphNode,
  GraphEdge,
  NodeRegistry,
  ToolProvider,
  NodeExecutorFunction,
  StatePropertyDefinition,
  ConditionConfig,
} from "../types.ts";
import { validateGraphStructure } from "../validation/validate-graph.ts";
import { START_NODE_ID, END_NODE_ID } from "../constants.ts";
import { getReducerFunction } from "./state.ts";
import { evaluateCondition, getFieldByPath } from "./conditions.ts";
import { executeLlmNode } from "./llm-executor.ts";
import { evaluateConditionWithFallback } from "./condition-evaluator.ts";

const toSource = (id: string) => (id === START_NODE_ID ? START : id);
const toTarget = (id: string) => (id === END_NODE_ID ? END : id);

export function buildStateSchema(
  definitions: Record<string, StatePropertyDefinition>,
): any {
  const schema: Record<string, any> = {};

  for (const [key, def] of Object.entries(definitions)) {
    const reducerFn = getReducerFunction(def.reducerStrategy);

    if (reducerFn) {
      schema[key] = {
        value: reducerFn as (a: unknown, b: unknown) => unknown,
      };
    } else {
      schema[key] = {
        value: (a: unknown, b: unknown) => (b !== undefined ? b : a),
      };
    }

    if (def.default !== undefined) {
      if (typeof schema[key] === "object" && schema[key] !== null) {
        // @ts-expect-error ReducedValue typing doesn't expose default dynamically
        (schema[key] as ReducedValue<any, any>).default = () => def.default;
      }
    }
  }

  return schema;
}

function validateAbstraction(abstraction: LangGraphAbstraction): void {
  const violations = validateGraphStructure(abstraction);
  if (violations.length > 0) {
    throw new Error(`Compiler Error: ${violations[0].reason}`);
  }
}


function buildNodeRunnable(
  node: GraphNode,
  registry: NodeRegistry,
  toolProvider?: ToolProvider,
): NodeExecutorFunction {
  if (node.type === "llm") {
    return async (state: Record<string, unknown>) => {
      return executeLlmNode(node.id, node.config, state, toolProvider);
    };
  }

  if (node.type === "condition") {
    return async (state: Record<string, unknown>) => {
      const cond = node.config?.condition as ConditionConfig | undefined;
      if (!cond || !cond.field) return {};
      if (getFieldByPath(state, cond.field) !== undefined) {
        return {};
      }
      return evaluateConditionWithFallback(node.id, node.name, cond, state);
    };
  }

  const executor =
    registry[node.config.pluginId as string] || registry[node.type];

  if (!executor) {
    throw new Error(
      `No executor found in registry for node ${node.id} (type: ${node.type})`,
    );
  }

  return async (state: Record<string, unknown>) => {
    try {
      return await executor(state, node.config);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`Error in node ${node.id}:`, errorMsg);
      throw new Error(`Node '${node.id}' failed: ${errorMsg}`);
    }
  };
}

function partitionEdges(abstraction: LangGraphAbstraction): {
  normalEdges: GraphEdge[];
  conditionalEdgesBySource: Record<string, GraphEdge[]>;
  conditionNodesMap: Map<string, GraphNode>;
} {
  const normalEdges: GraphEdge[] = [];
  const conditionalEdgesBySource: Record<string, GraphEdge[]> = {};
  const conditionNodesMap = new Map(
    abstraction.nodes
      .filter((n) => n.type === "condition")
      .map((n) => [n.id, n]),
  );

  for (const edge of abstraction.edges) {
    const isFromCondition =
      conditionNodesMap.has(edge.source) || edge.isConditional || !!edge.path;
    if (isFromCondition) {
      if (!conditionalEdgesBySource[edge.source]) {
        conditionalEdgesBySource[edge.source] = [];
      }
      conditionalEdgesBySource[edge.source].push(edge);
    } else {
      normalEdges.push(edge);
    }
  }

  return { normalEdges, conditionalEdgesBySource, conditionNodesMap };
}
function wireConditionalEdge(
  sourceId: string,
  edges: GraphEdge[],
  condNode: GraphNode | undefined,
): (state: Record<string, unknown>) => string {
  return (state: Record<string, unknown>): string => {
    if (condNode) {
      const cond = condNode.config?.condition as ConditionConfig | undefined;
      let isMatch = false;
      if (cond && cond.field) {
        const fieldValue = getFieldByPath(state, cond.field);
        isMatch = evaluateCondition(fieldValue, cond.operator, cond.value);
      }

      const trueEdge = edges.find((e) => e.path === "true");
      const falseEdge = edges.find((e) => e.path === "false");

      if (isMatch && trueEdge) return toTarget(trueEdge.target);
      if (!isMatch && falseEdge) return toTarget(falseEdge.target);

      const fallback = trueEdge || falseEdge || edges[0];
      return fallback ? toTarget(fallback.target) : END;
    }

    for (const edge of edges) {
      if (!edge.condition) continue;

      const targetId = toTarget(edge.target);
      const fieldValue = getFieldByPath(state, edge.condition.field);
      const match = evaluateCondition(
        fieldValue,
        edge.condition.operator,
        edge.condition.value,
      );
      if (match) return targetId as string;
    }

    throw new Error(
      `No matching conditional edge found for source node: ${sourceId}`,
    );
  };
}

export function compileGraph(
  abstraction: LangGraphAbstraction,
  stateSchema: any,
  registry: NodeRegistry,
  toolProvider?: ToolProvider,
) {
  validateAbstraction(abstraction);

  const workflow = new StateGraph<any, any, any, any>({
    channels: stateSchema as any,
  });

  for (const node of abstraction.nodes) {
    if (node.type === "start" || node.type === "end") continue;
    workflow.addNode(
      node.id,
      buildNodeRunnable(node, registry, toolProvider) as any,
    );
  }

  const { normalEdges, conditionalEdgesBySource, conditionNodesMap } =
    partitionEdges(abstraction);

  for (const edge of normalEdges) {
    const sourceId = toSource(edge.source);
    const targetId = toTarget(edge.target);
    workflow.addEdge(sourceId as any, targetId as any);
  }

  for (const [source, edges] of Object.entries(conditionalEdgesBySource)) {
    const sourceId = toSource(source);
    const condNode = conditionNodesMap.get(source);

    workflow.addConditionalEdges(
      sourceId as any,
      wireConditionalEdge(sourceId as string, edges, condNode),
    );
  }

  return workflow.compile();
}
