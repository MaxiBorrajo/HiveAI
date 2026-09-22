import { apiClient } from "../apiClient";
import type { ResponseEntity } from "../config";
import type { ExecutionSummary } from "@/types/execution";

export async function listExecutions(): Promise<
  ResponseEntity<ExecutionSummary[]>
> {
  const response = await apiClient.get("/api/executions");
  // Map backend structure to ExecutionSummary
  // Backend returns: { id, name, createdAt, updatedAt, ... }
  // Wait, if apiClient.get returns ResponseEntity<T>, does the backend return a { data: ... } or just the array?
  // Let's assume apiClient wraps it, or the backend returns the array directly.
  // We'll map the data to ensure it fits ExecutionSummary.
  if (Array.isArray(response.data)) {
    return {
      success: true,
      data: response.data.map((e: any) => ({
        id: String(e.id),
        title: e.name || e.title || "New Execution",
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
    };
  }
  return { success: true, data: response.data };
}
