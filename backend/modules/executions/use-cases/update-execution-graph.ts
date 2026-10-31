import { ResponseBuilder } from "../../../core/api/response.ts";
import { syncStateSchema } from "../../../core/ai/visual-builder/graph-factory.ts";
import type {
  InputMappingViolation,
  LangGraphAbstraction,
  PluginInfo,
} from "../../../core/ai/visual-builder/types.ts";
import { validateGraph } from "../../../core/ai/visual-builder/validation/validate-graph.ts";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import type { AppDatabase } from "../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../infrastructure/db/repositories/execution-repository.ts";
import { describeActivePlugins } from "./generate-execution/describe-plugins.ts";

export type PersistGraphResult =
  | { ok: true; newGraph: { id: number }; normalized: LangGraphAbstraction }
  | { ok: false; violations: InputMappingViolation[] };

/** Validates with the manual-edit rules and stores a new graph version. */
export async function persistValidatedGraph(
  repo: ExecutionRepository,
  execution: { id: number; lastGraphId: number | null },
  graph: LangGraphAbstraction,
  stateSchema: LangGraphAbstraction["stateSchema"] | undefined,
  options: {
    availablePlugins: PluginInfo[];
    orchestrator?: { provider: string; model: string; keyId?: string } | null;
  },
): Promise<PersistGraphResult> {
  const normalized = syncStateSchema({
    ...graph,
    stateSchema: stateSchema ?? graph.stateSchema,
  });

  const violations = validateGraph(normalized, options.availablePlugins);
  if (violations.length > 0) return { ok: false, violations };

  const previous = execution.lastGraphId
    ? await repo.findGraphById(execution.lastGraphId)
    : undefined;

  const newGraph = await repo.createGraph({
    executionId: execution.id,
    graph: normalized,
    state: normalized.stateSchema,
    orchestrator: options.orchestrator !== undefined
      ? options.orchestrator
      : previous?.orchestrator ?? null,
    createdAt: Date.now(),
  });

  await repo.update(execution.id, { lastGraphId: newGraph.id });
  return { ok: true, newGraph, normalized };
}

export function isGraphShape(graph: unknown): graph is LangGraphAbstraction {
  const candidate = graph as Partial<LangGraphAbstraction> | null;
  return !!candidate && Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges);
}

export async function updateExecutionGraph(
  db: AppDatabase,
  hive: HiveMicrokernel,
  id: number,
  graph: unknown,
  stateSchema: LangGraphAbstraction["stateSchema"] | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const repo = new ExecutionRepository(db);
    const execution = await repo.findById(id);
    if (!execution) {
      return ResponseBuilder.error(["Execution not found"], undefined, {
        headers,
        status: 404,
      });
    }

    if (!isGraphShape(graph)) {
      return ResponseBuilder.error(
        ["Invalid graph: 'nodes' and 'edges' must be arrays."],
        undefined,
        { headers, status: 400 },
      );
    }

    const saved = await persistValidatedGraph(repo, execution, graph, stateSchema, {
      availablePlugins: describeActivePlugins(hive),
    });
    if (!saved.ok) {
      return ResponseBuilder.error(
        saved.violations.map((v) => v.reason),
        { violations: saved.violations },
        { headers, status: 422 },
      );
    }
    const { newGraph, normalized } = saved;

    return ResponseBuilder.success(
      { success: true, graphId: newGraph.id, graph: normalized },
      { headers },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to update execution graph: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}
