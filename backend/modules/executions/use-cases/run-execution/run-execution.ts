import { createSseResponse, type SseSend } from "../../../../core/api/sse.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/execution-repository.ts";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { executionContextStorage } from "../../../../core/microkernel/human-interaction.ts";
import {
  buildStateSchema,
  compileGraph,
} from "../../../../core/ai/visual-builder/execution/compiler.ts";
import type {
  LangGraphAbstraction,
  ToolProvider,
} from "../../../../core/ai/visual-builder/types.ts";
import {
  applyDefaultModel,
  checkGraphModels,
  defaultModelCheckDeps,
} from "./check-models.ts";
import { parseMaybeJson } from "../../parse-maybe-json.ts";
import { createPluginNodeRegistry } from "./plugin-node-executor.ts";
import { finalizeExecutionResult } from "./result-normalizer.ts";

type CompiledGraph = ReturnType<typeof compileGraph>;
type FinalState = Record<string, any>;

type LoadedGraph =
  | { abstraction: LangGraphAbstraction; graphId: number }
  | { error: string };

async function loadGraph(
  repo: ExecutionRepository,
  executionId: number,
): Promise<LoadedGraph> {
  const execution = await repo.findById(executionId);
  if (!execution || !execution.lastGraphId) {
    return { error: "Execution or graph not found" };
  }

  const record = await repo.findGraphById(execution.lastGraphId);
  if (!record) return { error: "Graph record not found" };

  const graph = parseMaybeJson(record.graph) as LangGraphAbstraction;
  const abstraction: LangGraphAbstraction = {
    nodes: graph.nodes,
    edges: graph.edges,
    stateSchema: parseMaybeJson(record.state) as LangGraphAbstraction["stateSchema"],
  };
  return { abstraction, graphId: record.id };
}

function compileExecutionGraph(
  hive: HiveMicrokernel,
  abstraction: LangGraphAbstraction,
): CompiledGraph {
  const toolProvider: ToolProvider = {
    getTool: (name: string) => {
      const tool = hive.getTool(name);
      if (!tool) throw new Error(`Tool ${name} not found`);
      return tool;
    },
  };

  return compileGraph(
    abstraction,
    buildStateSchema(abstraction.stateSchema),
    createPluginNodeRegistry(hive),
    toolProvider,
  );
}

async function streamRun(
  app: CompiledGraph,
  inputState: Record<string, unknown> | undefined,
  send: SseSend,
): Promise<FinalState> {
  const initialInputs = {
    input: "",
    cwd: Deno.cwd(),
    os: Deno.build.os,
    ...inputState,
  };

  let finalState: FinalState = {};
  const events = await app.streamEvents(initialInputs, { version: "v2" });
  for await (const event of events) {
    send(event.event, event);
    if (event.event === "on_chain_end" && event.name === "LangGraph") {
      finalState = event.data.output || {};
    }
  }
  return finalState;
}

async function saveRun(
  repo: ExecutionRepository,
  executionId: number,
  graphId: number,
  finalState: FinalState,
) {
  const iteration = (await repo.countHistories(executionId)) + 1;

  const history = await repo.createHistory({
    executionId,
    iteration,
    result: JSON.stringify({ result: finalState.result, finalState }),
    version: graphId,
    createdAt: Date.now(),
  });
  await repo.update(executionId, { lastResultId: history.id });

  return { historyId: history.id, iteration };
}

export async function runExecution(
  db: AppDatabase,
  hive: HiveMicrokernel,
  id: number,
  inputState: Record<string, unknown> | undefined,
  headers: Record<string, string>,
  autoApprove = true,
): Promise<Response> {
  try {
    const repo = new ExecutionRepository(db);
    const loaded = await loadGraph(repo, id);
    if ("error" in loaded) {
      return ResponseBuilder.error([loaded.error], undefined, {
        headers,
        status: 404,
      });
    }

    const { abstraction, graphId } = loaded;
    applyDefaultModel(abstraction, hive);
    const problems = await checkGraphModels(abstraction, defaultModelCheckDeps());
    if (problems.length > 0) {
      return ResponseBuilder.error(
        problems.map((p) => p.reason),
        { problems },
        { headers, status: 422 },
      );
    }
    const app = compileExecutionGraph(hive, abstraction);

    return createSseResponse(headers, (send) =>
      executionContextStorage.run({ autoApprove }, async () => {
        const finalState = await streamRun(app, inputState, send);
        finalizeExecutionResult(finalState, abstraction.nodes);

        const { historyId, iteration } = await saveRun(
          repo,
          id,
          graphId,
          finalState,
        );
        send("done", {
          historyId,
          iteration,
          result: finalState.result,
          finalState,
        });
      }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to run execution: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}
