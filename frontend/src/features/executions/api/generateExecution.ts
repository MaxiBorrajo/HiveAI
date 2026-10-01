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
    if (eventName === "execution_created") {
      handlers.onExecutionCreated?.(String(data.executionId));
    } else if (eventName === "planning") {
      handlers.onPlanning?.(data.thoughts);
    } else if (eventName === "node_added") {
      handlers.onNodeAdded?.(data);
    } else if (eventName === "node_configuring") {
      handlers.onNodeConfiguring?.(data);
    } else if (eventName === "node_updated") {
      handlers.onNodeUpdated?.(data);
    } else if (eventName === "node_deleted") {
      handlers.onNodeDeleted?.(data);
    } else if (eventName === "edge_added") {
      handlers.onEdgeAdded?.(data);
    } else if (eventName === "done") {
      handlers.onDone?.(data);
    } else if (eventName === "error") {
      handlers.onError?.(data.message);
    }
  }, signal);
}
