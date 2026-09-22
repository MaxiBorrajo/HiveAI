import { StateGraph, ReducedValue, START, END } from "@langchain/langgraph";
import {
  LangGraphAbstraction,
  GraphEdge,
  NodeRegistry,
  ToolProvider,
  NodeExecutorFunction,
  StatePropertyDefinition,
} from "./types.ts";
import {
  getReducerFunction,
  evaluateCondition,
} from "./utils.ts";
import {
  buildLlmInstance,
  buildPromptMessages,
  mapResponseToState,
  handleLlmError,
} from "./llm-executor.ts";

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

export function compileGraph(
  abstraction: LangGraphAbstraction,
  stateSchema: any,
  registry: NodeRegistry,
  toolProvider?: ToolProvider,
) {
  const nodeIds = new Set<string>();
  let startCount = 0;
  let endCount = 0;

  for (const node of abstraction.nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Compiler Error: Duplicate node ID found: '${node.id}'. All node IDs must be unique.`);
    }
    nodeIds.add(node.id);
    if (node.type === "start") startCount++;
    if (node.type === "end") endCount++;
  }

  if (startCount !== 1) throw new Error(`Compiler Error: The graph must have exactly one node of type 'start'. Found: ${startCount}`);
  if (endCount !== 1) throw new Error(`Compiler Error: The graph must have exactly one node of type 'end'. Found: ${endCount}`);

  const workflow = new StateGraph<any, any, any, any>({
    channels: stateSchema as any,
  });

  for (const node of abstraction.nodes) {
    if (node.type === "start" || node.type === "end") continue;

    let nodeRunnable: NodeExecutorFunction;

    if (node.type === "llm") {
      nodeRunnable = async (state: Record<string, unknown>) => {
        try {
          // 1. Preparamos el LLM
          const llm = buildLlmInstance(node.id, node.config, toolProvider);

          // 2. Preparamos los mensajes
          const messages = buildPromptMessages(state, node.config);

          // 3. Ejecutamos
          const response = await llm.invoke(messages);

          // 4. Mapeamos la salida al estado
          return mapResponseToState(response, node.config, state);
        } catch (err: unknown) {
          return handleLlmError(err, node.id, node.config);
        }
      };
    } else {
      const executor =
        registry[node.config.pluginId as string] || registry[node.type];

      if (!executor) {
        throw new Error(
          `No executor found in registry for node ${node.id} (type: ${node.type})`,
        );
      }

      nodeRunnable = async (state: Record<string, unknown>) => {
        try {
          return await executor(state, node.config);
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`Error in node ${node.id}:`, errorMsg);
          return { result: { error: errorMsg, nodeId: node.id } };
        }
      };
    }

    workflow.addNode(node.id, nodeRunnable as any);
  }

  const normalEdges: GraphEdge[] = [];
  const conditionalEdgesBySource: Record<string, GraphEdge[]> = {};

  for (const edge of abstraction.edges) {
    if (!edge.isConditional) {
      normalEdges.push(edge);
    } else {
      if (!conditionalEdgesBySource[edge.source]) {
        conditionalEdgesBySource[edge.source] = [];
      }
      conditionalEdgesBySource[edge.source].push(edge);
    }
  }

  for (const edge of normalEdges) {
    const sourceId = edge.source === "start" ? START : edge.source;
    const targetId = edge.target === "end" ? END : edge.target;
    workflow.addEdge(sourceId as any, targetId as any);
  }

  for (const [source, edges] of Object.entries(conditionalEdgesBySource)) {
    const sourceId = source === "start" ? START : source;

    workflow.addConditionalEdges(
      sourceId as any,
      (state: Record<string, unknown>): string => {
        for (const edge of edges) {
          if (!edge.condition) continue;

          const targetId = edge.target === "end" ? END : edge.target;

          const fieldParts = edge.condition.field.split(".");
          let fieldValue: unknown = state;
          for (const part of fieldParts) {
            fieldValue = (fieldValue as Record<string, unknown>)?.[part];
          }

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
      },
    );
  }

  return workflow.compile();
}
