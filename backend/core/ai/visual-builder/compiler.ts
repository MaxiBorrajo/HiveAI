import {
  StateGraph,
  StateSchema,
  ReducedValue,
  START,
  END,
} from "@langchain/langgraph";
import { z } from "zod";
import {
  StatePropertyDefinition,
  ReducerStrategy,
  LangGraphAbstraction,
  GraphNode,
  GraphEdge,
  ConditionOperator,
} from "./types.ts";

/**
 * Registry of node execution functions.
 * In a real application, these would be your dynamically loaded plugins.
 */
export type NodeExecutorFunction = (
  state: Record<string, unknown>,
  config: Record<string, unknown>,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface NodeRegistry {
  [nodeIdOrType: string]: NodeExecutorFunction;
}

// Helper to map strategy to a reducer function
function getReducerFunction(
  strategy?: ReducerStrategy,
): ((a: unknown, b: unknown) => unknown) | undefined {
  switch (strategy) {
    case "append":
      return (a: unknown, b: unknown) => [
        ...((a as []) || []),
        ...((b as []) || []),
      ];
    case "prepend":
      return (a: unknown, b: unknown) => [
        ...((b as []) || []),
        ...((a as []) || []),
      ];
    case "unique_append":
      return (a: unknown, b: unknown) =>
        Array.from(new Set([...((a as []) || []), ...((b as []) || [])]));
    case "merge_dict":
      return (a: unknown, b: unknown) => ({
        ...((a as object) || {}),
        ...((b as object) || {}),
      });
    case "sum":
      return (a: unknown, b: unknown) =>
        ((a as number) || 0) + ((b as number) || 0);
    case "subtract":
      return (a: unknown, b: unknown) =>
        ((a as number) || 0) - ((b as number) || 0);
    case "multiply":
      return (a: unknown, b: unknown) =>
        ((a as number) !== undefined ? (a as number) : 1) *
        ((b as number) !== undefined ? (b as number) : 1);
    case "divide":
      return (a: unknown, b: unknown) => {
        if (b === 0) throw new Error("Division by zero in reducer");
        return (
          ((a as number) !== undefined ? (a as number) : 1) /
          ((b as number) !== undefined ? (b as number) : 1)
        );
      };
    case "overwrite":
    default:
      // In LangGraph, if no reducer is provided, it automatically overwrites
      return undefined;
  }
}

// Helper to convert StatePropertyDefinition to Zod Schema
function mapTypeToZod(def: StatePropertyDefinition): z.ZodType {
  let schema: z.ZodType;
  switch (def.type) {
    case "string":
      schema = z.string();
      break;
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "enum":
      if (def.options && def.options.length > 0) {
        schema = z.enum(def.options as [string, ...string[]]);
      } else {
        schema = z.string();
      }
      break;
    case "array":
      if (def.items) {
        schema = z.array(mapTypeToZod(def.items));
      } else {
        schema = z.array(z.unknown());
      }
      break;
    case "object":
      if (def.properties) {
        const shape: Record<string, z.ZodType> = {};
        for (const [key, propDef] of Object.entries(def.properties)) {
          shape[key] = mapTypeToZod(propDef);
        }
        schema = z.object(shape);
      } else {
        schema = z.record(z.string(), z.unknown());
      }
      break;
    case "unknown":
    default:
      schema = z.unknown();
      break;
  }

  if (!def.required) {
    schema = schema.optional();
  }
  if (def.default !== undefined) {
    schema = schema.default(def.default);
  }

  return schema;
}

// Evaluate a condition for dynamic routing
function evaluateCondition(
  fieldValue: unknown,
  operator: ConditionOperator,
  targetValue: unknown,
): boolean {
  switch (operator) {
    case "equals":
      return fieldValue === targetValue;
    case "not_equals":
      return fieldValue !== targetValue;
    case "greater_than":
      return (fieldValue as number) > (targetValue as number);
    case "greater_than_or_equals":
      return (fieldValue as number) >= (targetValue as number);
    case "less_than":
      return (fieldValue as number) < (targetValue as number);
    case "less_than_or_equals":
      return (fieldValue as number) <= (targetValue as number);
    case "contains":
      return Array.isArray(fieldValue) || typeof fieldValue === "string"
        ? fieldValue.includes(targetValue as string)
        : false;
    case "not_contains":
      return Array.isArray(fieldValue) || typeof fieldValue === "string"
        ? !fieldValue.includes(targetValue as string)
        : true;
    case "starts_with":
      return (
        typeof fieldValue === "string" &&
        fieldValue.startsWith(targetValue as string)
      );
    case "ends_with":
      return (
        typeof fieldValue === "string" &&
        fieldValue.endsWith(targetValue as string)
      );
    case "is_empty":
      return (
        fieldValue === null ||
        fieldValue === undefined ||
        fieldValue === "" ||
        (Array.isArray(fieldValue) && fieldValue.length === 0)
      );
    case "is_not_empty":
      return (
        fieldValue !== null &&
        fieldValue !== undefined &&
        fieldValue !== "" &&
        (!Array.isArray(fieldValue) || fieldValue.length > 0)
      );
    case "in":
      return Array.isArray(targetValue) && targetValue.includes(fieldValue);
    case "not_in":
      return Array.isArray(targetValue) && !targetValue.includes(fieldValue);
    case "regex_match":
      return new RegExp(targetValue as string).test(fieldValue as string);
    default:
      return false;
  }
}

/**
 * Compiles a JSON State Definition into a LangGraph StateSchema
 */
export function buildStateSchema(
  stateDef: Record<string, StatePropertyDefinition>,
) {
  const schemaObj: Record<string, z.ZodType | ReducedValue<any, any>> = {};

  for (const [key, def] of Object.entries(stateDef)) {
    const zodSchema = mapTypeToZod(def);
    const reducer = getReducerFunction(def.reducerStrategy);

    if (reducer) {
      schemaObj[key] = new ReducedValue(zodSchema, { reducer });
    } else {
      schemaObj[key] = zodSchema;
    }
  }

  // Forcibly inject a 'result' property as an overwrite bucket
  schemaObj.result = z.unknown();

  return new StateSchema(schemaObj);
}

export interface ToolProvider {
  getTool(name: string): any; // LangChain Tool
}

/**
 * Compiles a visual LangGraphAbstraction into an executable StateGraph
 */
export function compileGraph(
  abstraction: LangGraphAbstraction,
  stateSchema: StateSchema<any>,
  registry: NodeRegistry,
  toolProvider?: ToolProvider, // Inyectamos el microkernel aquí
) {
  // Use any to bypass strict internal typing for dynamic graphs
  const workflow = new StateGraph<any, any, any, any>(stateSchema);

  // 1. Add Nodes
  for (const node of abstraction.nodes) {
    if (node.type === "start" || node.type === "end") continue;

    let nodeRunnable: (
      state: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;

    // Si el nodo es puramente de tipo LLM, lo manejamos nativamente con los tools del microkernel
    if (node.type === "llm") {
      nodeRunnable = async (state: Record<string, unknown>) => {
        try {
          // Aquí en el futuro instanciarás el LLM real (Ollama, OpenAI, etc.)
          // dependiendo de node.config.model. Por ahora simulamos la validación de tools.

          const toolsToBind = [];
          if (node.config.plugins && Array.isArray(node.config.plugins)) {
            if (!toolProvider) {
              throw new Error(
                "ToolProvider (Microkernel) is required to execute LLM nodes with plugins.",
              );
            }

            for (const pluginName of node.config.plugins) {
              const tool = toolProvider.getTool(pluginName);
              if (!tool) {
                throw new Error(
                  `Plugin '${pluginName}' was requested by node '${node.id}' but is not registered in the Microkernel.`,
                );
              }
              toolsToBind.push(tool);
            }
          }

          // Simulación de ejecución genérica (Aquí reemplazarías con llm.bindTools(toolsToBind).invoke(...))
          // Por defecto, si el usuario registra un ejecutor genérico "llm" en el registry, lo usamos,
          // pasándole los tools ya resueltos en el config.
          const executor = registry["llm"];
          if (executor) {
            // Le inyectamos los tools verificados al config
            return await executor(state, {
              ...node.config,
              resolvedTools: toolsToBind,
            });
          }

          throw new Error("No default LLM executor found in registry.");
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`Error in LLM node ${node.id}:`, errorMsg);
          return { result: { error: errorMsg, nodeId: node.id } };
        }
      };
    } else {
      // Para otros tipos de nodos (compute, tool genérico, etc), buscamos en el registry
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

    workflow.addNode(node.id, nodeRunnable);
  }

  // 2. Add Edges
  // Group conditional edges by source
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

  // Add normal edges
  for (const edge of normalEdges) {
    const sourceId = edge.source === "start" ? START : edge.source;
    const targetId = edge.target === "end" ? END : edge.target;
    workflow.addEdge(sourceId, targetId);
  }

  // Add grouped conditional edges
  for (const [source, edges] of Object.entries(conditionalEdgesBySource)) {
    const sourceId = source === "start" ? START : source;

    // Create a single routing function for all conditional edges from this source
    workflow.addConditionalEdges(
      sourceId as any,
      (state: Record<string, unknown>): string => {
        for (const edge of edges) {
          if (!edge.condition) continue;

          const targetId = edge.target === "end" ? END : edge.target;

          // Read the nested path from state
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

        // If no conditions match, we must throw an error. LangGraph requires a definitive
        // next node (or END) to continue execution. Returning undefined breaks the graph.
        throw new Error(
          `No matching conditional edge found for source node: ${sourceId}`,
        );
      },
    );
  }

  return workflow.compile();
}
