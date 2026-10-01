import { postSse } from "../../../lib/sse";
import type {
  LangGraphAbstraction,
  GraphNode,
  GraphEdge,
  StatePropertyDefinition,
} from "@/features/executions/types";

export interface GenerateExecutionPayload {
  content: string;
  executionId?: number;
  targetNodeId?: string;
  currentGraph?: LangGraphAbstraction;
  dryRun?: boolean;
}


export interface GenerateStreamHandlers {
  onExecutionCreated?: (executionId: string) => void;
  onPlanning?: (thoughts: string) => void;
  onNodeAdded?: (data: {
    node: GraphNode;
    edge?: GraphEdge;
    stateProperties?: Record<string, StatePropertyDefinition>;
  }) => void;
  onNodeConfiguring?: (data: {
    nodeId: string;
    nodeName: string;
  }) => void;
  onNodeUpdated?: (data: {
    node: GraphNode;
    stateProperties?: Record<string, StatePropertyDefinition>;
  }) => void;
  onNodeDeleted?: (data: { nodeId: string }) => void;
  onEdgeAdded?: (data: {
    edge: GraphEdge;
  }) => void;
  onDone?: (data: {
    executionId: number;
    graphId: number;
    graph: LangGraphAbstraction;
  }) => void;
  onError?: (message: string) => void;
}

export async function generateExecutionStream(
  payload: GenerateExecutionPayload,
  handlers: GenerateStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await postSse("/api/executions/generate", payload, (eventName, data) => {
    switch (eventName) {
      case "execution_created":
        handlers.onExecutionCreated?.(String(data.executionId));
        break;
      case "planning":
        handlers.onPlanning?.(data.thoughts);
        break;
      case "node_added":
        handlers.onNodeAdded?.(data);
        break;
      case "node_configuring":
        handlers.onNodeConfiguring?.(data);
        break;
      case "node_updated":
        handlers.onNodeUpdated?.(data);
        break;
      case "node_deleted":
        handlers.onNodeDeleted?.(data);
        break;
      case "edge_added":
        handlers.onEdgeAdded?.(data);
        break;
      case "done":
        handlers.onDone?.(data);
        break;
      case "error":
        handlers.onError?.(data.message);
        break;
    }
  }, signal);
}
