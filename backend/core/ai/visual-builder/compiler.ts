import { StateGraph, ReducedValue, START, END } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import { HumanMessage } from "@langchain/core/messages";
import {
  LangGraphAbstraction,
  GraphEdge,
  NodeRegistry,
  ToolProvider,
  NodeExecutorFunction,
  StatePropertyDefinition,
} from "./types.ts";
import { getReducerFunction, evaluateCondition } from "./utils.ts";
import {
  buildLlmInstance,
  buildPromptMessages,
  mapResponseToState,
  handleLlmError,
  executeLlmNode,
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
      throw new Error(
        `Compiler Error: Duplicate node ID found: '${node.id}'. All node IDs must be unique.`,
      );
    }
    nodeIds.add(node.id);
    if (node.type === "start") startCount++;
    if (node.type === "end") endCount++;
  }

  if (startCount !== 1)
    throw new Error(
      `Compiler Error: The graph must have exactly one node of type 'start'. Found: ${startCount}`,
    );
  if (endCount !== 1)
    throw new Error(
      `Compiler Error: The graph must have exactly one node of type 'end'. Found: ${endCount}`,
    );

  const workflow = new StateGraph<any, any, any, any>({
    channels: stateSchema as any,
  });

  for (const node of abstraction.nodes) {
    if (node.type === "start" || node.type === "end") continue;

    let nodeRunnable: NodeExecutorFunction;

    if (node.type === "llm") {
      nodeRunnable = async (state: Record<string, unknown>) => {
        return executeLlmNode(node.id, node.config, state, toolProvider);
      };
    } else if (node.type === "condition") {
      // Condition nodes are decision gateways with intelligent fallback evaluation
      nodeRunnable = async (state: Record<string, unknown>) => {
        const cond = node.config?.condition as any;
        if (!cond || !cond.field) return {};

        const fieldParts = cond.field.split(".");
        let fieldValue: unknown = state;
        for (const part of fieldParts) {
          fieldValue = (fieldValue as Record<string, unknown>)?.[part];
        }

        // If field already exists in state, pass through
        if (fieldValue !== undefined) {
          return {};
        }

        // Semantic evaluator: If field is missing, evaluate contextually with Ollama
        try {
          const modelName =
            (node.config?.model as string) ||
            (state.model as string) ||
            "qwen2.5:latest";

          const llm = new ChatOllama({ model: modelName, temperature: 0 });

          let contextContent = "";
          if (Array.isArray(state.messages) && state.messages.length > 0) {
            const lastMsg = state.messages[state.messages.length - 1];
            contextContent =
              typeof lastMsg === "string"
                ? lastMsg
                : (lastMsg as any)?.content || JSON.stringify(lastMsg);
          } else if (typeof state.content === "string") {
            contextContent = state.content;
          } else if (state.result !== undefined) {
            contextContent =
              typeof state.result === "string"
                ? state.result
                : JSON.stringify(state.result);
          } else {
            contextContent = JSON.stringify(state);
          }

          const prompt = `Evaluate if the following condition is satisfied based on the provided context.
Condition: "${node.name}" (${cond.field} ${cond.operator} ${JSON.stringify(cond.value)})
Context:
${contextContent.slice(0, 1500)}

Is the condition satisfied?
Reply with ONLY the word "true" or "false".`;

          const res = await llm.invoke([new HumanMessage(prompt)]);
          const reply = String(res.content).trim().toLowerCase();
          const isSatisfied = reply.includes("true");

          let evaluatedValue: unknown = isSatisfied;
          if (cond.operator === "equals") {
            evaluatedValue = isSatisfied ? cond.value : !cond.value;
          }

          console.log(
            `[Condition Evaluator] Node "${node.id}" evaluated missing field "${cond.field}" ->`,
            evaluatedValue,
          );
          return { [cond.field]: evaluatedValue };
        } catch (err: unknown) {
          console.warn(`[Condition Evaluator] Fallback evaluation for ${node.id} failed:`, err);
          return {};
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

  for (const edge of normalEdges) {
    const sourceId = edge.source === "start" ? START : edge.source;
    const targetId = edge.target === "end" ? END : edge.target;
    workflow.addEdge(sourceId as any, targetId as any);
  }

  for (const [source, edges] of Object.entries(conditionalEdgesBySource)) {
    const sourceId = source === "start" ? START : source;
    const condNode = conditionNodesMap.get(source);

    workflow.addConditionalEdges(
      sourceId as any,
      (state: Record<string, unknown>): string => {
        if (condNode) {
          const cond = condNode.config?.condition as any;
          let isMatch = false;
          if (cond && cond.field) {
            const fieldParts = cond.field.split(".");
            let fieldValue: unknown = state;
            for (const part of fieldParts) {
              fieldValue = (fieldValue as Record<string, unknown>)?.[part];
            }
            isMatch = evaluateCondition(
              fieldValue,
              cond.operator,
              cond.value,
            );
          }

          const trueEdge = edges.find((e) => e.path === "true");
          const falseEdge = edges.find((e) => e.path === "false");

          if (isMatch && trueEdge) {
            return trueEdge.target === "end" ? END : trueEdge.target;
          }
          if (!isMatch && falseEdge) {
            return falseEdge.target === "end" ? END : falseEdge.target;
          }

          const fallback = trueEdge || falseEdge || edges[0];
          return fallback
            ? fallback.target === "end"
              ? END
              : fallback.target
            : END;
        }

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
