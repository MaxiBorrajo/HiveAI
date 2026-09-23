import { apiClient } from "../apiClient";
import { readSseStream } from "../sse";
import type {
  LangGraphAbstraction,
  GraphNode,
  GraphEdge,
  StatePropertyDefinition,
} from "@/types/execution";

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
  onNodeUpdated?: (data: {
    node: GraphNode;
    stateProperties?: Record<string, StatePropertyDefinition>;
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
): Promise<void> {
  const response = await apiClient.post(
    "/api/executions/generate",
    payload,
    {
      responseType: "stream",
      adapter: "fetch",
    },
  );

  if (!response.data) {
    throw new Error("The backend responded with no body");
  }

  await readSseStream(response.data, (eventName, data) => {
    if (eventName === "execution_created") {
      handlers.onExecutionCreated?.(String(data.executionId));
    } else if (eventName === "planning") {
      handlers.onPlanning?.(data.thoughts);
    } else if (eventName === "node_added") {
      handlers.onNodeAdded?.(data);
    } else if (eventName === "node_updated") {
      handlers.onNodeUpdated?.(data);
    } else if (eventName === "done") {
      handlers.onDone?.(data);
    } else if (eventName === "error") {
      handlers.onError?.(data.message);
    }
  });
}

export async function generateExecution(
  payload: GenerateExecutionPayload,
): Promise<{
  data: {
    executionId: number;
    graphId: number;
    graph: LangGraphAbstraction;
  };
}> {
  return new Promise((resolve, reject) => {
    let finalData: any = null;
    generateExecutionStream(payload, {
      onDone: (data) => {
        finalData = data;
      },
      onError: (msg) => {
        reject(new Error(msg));
      },
    })
      .then(() => {
        if (finalData) {
          resolve({ data: finalData });
        } else {
          reject(new Error("Stream ended without done event"));
        }
      })
      .catch(reject);
  });
}

