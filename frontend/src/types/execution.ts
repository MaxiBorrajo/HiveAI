export type DataType = "string" | "number" | "boolean" | "object" | "array" | "enum" | "unknown";
export type ReducerStrategy = "overwrite" | "append" | "prepend" | "unique_append" | "merge_dict" | "sum" | "subtract" | "multiply" | "divide";

export interface StatePropertyDefinition {
  type: DataType;
  required: boolean;
  default?: any;
  properties?: Record<string, StatePropertyDefinition>;
  items?: StatePropertyDefinition;
  options?: string[];
  reducerStrategy?: ReducerStrategy;
}

export type NodeType = "start" | "end" | "llm" | "plugin" | "condition";

export interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  uiPosition?: { x: number; y: number };
  config: Record<string, any>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  path?: "true" | "false"; // Used if source is a condition node
  isConditional: boolean;
  condition?: {
    field: string;
    operator: string;
    value: unknown;
  };
}

export interface LangGraphAbstraction {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stateSchema: Record<string, StatePropertyDefinition>;
}

export interface Execution {
  id: number;
  name: string;
  lastResultId: number | null;
  lastGraphId: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ExecutionSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}
