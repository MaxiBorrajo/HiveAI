// ==========================================
// 1. STATE & REDUCERS
// ==========================================
export type ReducerStrategy =
  | "overwrite" // Overwrites old with new (default)
  | "append" // Appends to the end of an array
  | "prepend" // Prepends to the start of an array
  | "unique_append" // Appends to array only if not already present
  | "merge_dict" // Object.assign(old, new)
  | "sum" // old + new
  | "subtract" // old - new
  | "multiply" // old * new
  | "divide"; // old / new

export type DataType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "enum"
  | "unknown";

export interface StatePropertyDefinition {
  name?: string; // Not strictly required in properties object if used as a record value
  type: DataType;
  description?: string;
  required: boolean;
  default?: any;

  // Support for nesting and collections
  properties?: Record<string, StatePropertyDefinition>; // If type === 'object'
  items?: StatePropertyDefinition; // If type === 'array'
  options?: string[]; // If type === 'enum'

  // Reducer strategy. If omitted, 'overwrite' is assumed
  reducerStrategy?: ReducerStrategy;
}

// ==========================================
// 2. NODES
// ==========================================
export type NodeType = "start" | "end" | "llm" | "agent" | "plugin" | "condition";

export interface GraphNode {
  id: string; // Internal ID (e.g. "node_123")
  name: string; // Visual label (e.g. "AI Analyst")
  type: NodeType;

  // Render position for React Flow
  uiPosition?: { x: number; y: number };

  config: Record<string, unknown>; // Dynamic configuration for plugin/function
}

export type NodeExecutorFunction = (
  state: Record<string, unknown>,
  config: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export type NodeRegistry = Record<string, NodeExecutorFunction>;

export interface ToolProvider {
  getTool(name: string): any; // LangChain Tool
}

// ==========================================
// 3. EDGES & CONDITIONS
// ==========================================
export type ConditionOperator =
  // Equality
  | "equals"
  | "not_equals"
  // Mathematical
  | "greater_than"
  | "greater_than_or_equals"
  | "less_than"
  | "less_than_or_equals"
  // Strings / Collections
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  // Existence
  | "is_empty"
  | "is_not_empty"
  // Lists
  | "in"
  | "not_in"
  // Advanced
  | "regex_match";

export interface GraphEdge {
  id: string; // Connection ID (e.g. "edge_1")
  source: string; // Source node ID
  target: string; // Target node ID (or "__end__")
  path?: "true" | "false"; // Used if source is a condition node

  isConditional: boolean;

  // Rule is evaluated ONLY if isConditional === true
  condition?: {
    field: string; // Path in state (e.g. "evaluation.score" or "messages")
    operator: ConditionOperator;
    value: unknown; // Static value to compare against
  };
}

// ==========================================
// 4. ROOT JSON
// ==========================================
export interface LangGraphAbstraction {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stateSchema: Record<string, StatePropertyDefinition>;
}

// ==========================================
// 5. EXECUTION RESULTS & DELIVERABLES
// ==========================================
export type ExecutionResultType =
  // Documentos y Archivos
  | "file"
  | "markdown"
  | "text"
  // Datos y Analítica
  | "table"
  | "chart"
  | "json"
  // Multimedia y Web
  | "image"
  | "html"
  | "url"
  // Operaciones y Lógica
  | "terminal"
  | "boolean"
  | "error";

export interface ExecutionFileArtifact {
  name: string;
  path: string;
  size?: number;
  mimeType?: string;
}

export interface ExecutionResult {
  type: ExecutionResultType;
  summary: string;
  content: any;
  files?: ExecutionFileArtifact[];
  metadata?: Record<string, any>;
}


