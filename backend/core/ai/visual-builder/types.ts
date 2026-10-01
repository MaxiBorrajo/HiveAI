import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ChatOllama } from "@langchain/ollama";
import type { buildLlmConfigSchema } from "./generation/llm-node-configurator.ts";
import type z from "zod";
import type { buildPluginConfigSchema } from "./generation/plugin-node-configurator.ts";
import type { buildWorkflowSkeletonSchema } from "./generation/topology-compiler.ts";

export type ReducerStrategy =
  | "overwrite"
  | "append" 
  | "prepend" 
  | "unique_append" 
  | "merge_dict"
  | "sum"
  | "subtract" 
  | "multiply" 
  | "divide";

export type DataType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "enum"
  | "unknown";

export interface StatePropertyDefinition {
  name?: string;
  type: DataType;
  description?: string;
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
  config: Record<string, unknown>; 
}

export type NodeExecutorFunction = (
  state: Record<string, unknown>,
  config: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export type NodeRegistry = Record<string, NodeExecutorFunction>;

export interface ToolProvider {
  getTool(name: string): StructuredToolInterface | undefined;
}

export type { ConditionOperator } from "./condition-operators.ts";
import type { ConditionOperator } from "./condition-operators.ts";

export interface ConditionConfig {
  field: string; 
  operator: ConditionOperator;
  value: unknown;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  path?: "true" | "false";
  isConditional: boolean;
  condition?: ConditionConfig;
}

export interface LlmConfig {
  model?: string
  systemPrompt?: string;
  plugins?: string[];
  pluginId?: string;
  structuredOutput?: StatePropertyDefinition;
  outputKey?: string;
  inputMapping?: Record<string, string>;
  [key: string]: unknown;
}

export interface LangGraphAbstraction {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stateSchema: Record<string, StatePropertyDefinition>;
}

export type ExecutionResultType =
  | "file"
  | "markdown"
  | "text"
  | "table"
  | "chart"
  | "json"
  | "image"
  | "html"
  | "url"
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

export type IncrementalEvent =
  | { type: "planning"; thoughts: string }
  | {
      type: "node_added";
      node: GraphNode;
      edge?: GraphEdge;
      stateProperties?: Record<string, any>;
    }
  | {
      type: "node_configuring";
      nodeId: string;
      nodeName: string;
    }
  | {
      type: "node_updated";
      node: GraphNode;
      stateProperties?: Record<string, any>;
    }
  | { type: "edge_added"; edge: GraphEdge }
  | {
      type: "validation_error";
      violations: InputMappingViolation[];
      attempt: number;
    }
  | {
      type: "node_fixed";
      node: GraphNode;
      stateProperties?: Record<string, any>;
    };

export type ViolationKind =
  | "syntax"
  | "undefined_variable"
  | "invalid_plugin_param"
  | "unequipped_tool_mention"
  | "unknown_plugin"
  | "missing_condition_branch"
  | "condition_branches_converge"
  | "invalid_node_shape"
  | "condition_edge_missing_path";

export interface InputMappingViolation {
  kind: ViolationKind;
  nodeId: string;
  nodeName: string;
  field: string;
  invalidValue: string;
  reason: string;
}

export interface PluginParameterInfo {
  name: string;
  parameterKeys?: string[];
}

export interface ConditionNodeConfiguratorContext {
  prompt: string;
  configLlm: ChatOllama;
  graph: LangGraphAbstraction;
  graphStateText: string;
}

export interface EndNodeConfiguratorContext {
  prompt: string;
  configLlm: ChatOllama;
  graph: LangGraphAbstraction;
  intermediateNodes: GraphNode[];
}

export interface InvocableAgent {
  invoke: (input: any, config?: any) => Promise<any>;
}

export interface InterpolationSelfCorrectionContext {
  graph: LangGraphAbstraction;
  availablePlugins: PluginInfo[];
  configLlm: ChatOllama;
  nodeDescriptions: Map<string, string>;
}

export interface LlmNodeConfiguratorContext {
  prompt: string;
  modelName: string;
  availablePlugins: PluginInfo[];
  pluginNames: Set<string>;
  configLlm: ChatOllama;
  graph: LangGraphAbstraction;
  intermediateNodes: GraphNode[];
  nodeDescriptions: Map<string, string>;
  neighborHint: string;
  graphStateText: string;
}

export type LlmConfigCandidate = z.infer<ReturnType<typeof buildLlmConfigSchema>>;

export interface PluginNodeConfiguratorContext {
  prompt: string;
  availablePlugins: PluginInfo[];
  pluginNames: Set<string>;
  configLlm: ChatOllama;
  graph: LangGraphAbstraction;
  intermediateNodes: GraphNode[];
  nodeDescriptions: Map<string, string>;
  neighborHint: string;
  graphStateText: string;
}

export type PluginConfigCandidate = z.infer<ReturnType<typeof buildPluginConfigSchema>>;

export interface NormalizedSkeleton {
  startNode: GraphNode;
  endNode: GraphNode;
  intermediateNodes: GraphNode[];
  nodeDescriptions: Map<string, string>;
  rawEdges: GraphEdge[];
}

export type SkeletonNode = WorkflowSkeleton["nodes"][number];
export type SkeletonEdge = WorkflowSkeleton["edges"][number];

export interface PluginInfo {
  name: string;
  description: string;
  parametersDescription?: string;
  parameterKeys?: string[];
  requiredKeys?: string[];
  parameterSchema?: Record<string, z.ZodTypeAny>;
  returnDescription?: string;
}

export type WorkflowSkeleton = z.infer<ReturnType<typeof buildWorkflowSkeletonSchema>>;