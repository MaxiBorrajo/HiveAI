import { isAxiosError } from "axios";
import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { GraphViolation, LangGraphAbstraction } from "../types";

export type SaveGraphResult =
  | { ok: true; graph: LangGraphAbstraction }
  | { ok: false; violations: GraphViolation[]; errors: string[] };


export async function saveExecutionGraph(
  id: string,
  graph: LangGraphAbstraction,
): Promise<SaveGraphResult> {
  try {
    const response = await apiClient.put<
      ResponseEntity<{ graphId: number; graph: LangGraphAbstraction }>
    >(`/api/executions/${id}/graph`, { graph, stateSchema: graph.stateSchema }, {
      silenceErrorToast: true,
    });
    return { ok: true, graph: response.data.data?.graph ?? graph };
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 422) {
      const body = error.response.data as ResponseEntity<{ violations?: GraphViolation[] }>;
      return {
        ok: false,
        violations: body.data?.violations ?? [],
        errors: body.errors ?? [],
      };
    }
    throw error;
  }
}
