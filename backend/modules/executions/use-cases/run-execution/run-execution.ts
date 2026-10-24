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
import { withUsageContext } from "../../../../core/ai/usage/usage-context.ts";
import { getCurrentModelRef } from "../../../../core/ai/providers/current-model.ts";
import { ApiKeyRepository } from "../../../../infrastructure/db/repositories/api-key-repository.ts";
import { resolveOrchestrator, snapshotNodes } from "./run-snapshot.ts";
import type { RunInfo } from "../../../usage/run-info.ts";
import { ModelUsageRepository } from "../../../../infrastructure/db/repositories/model-usage-repository.ts";
import { AttachmentRepository } from "../../../../infrastructure/db/repositories/attachment-repository.ts";
import { saveAttachment } from "../../../../core/attachments/attachment-storage.ts";
import { buildAttachmentContent } from "../../../../core/attachments/build-attachment-content.ts";
import { normalizeModelRef } from "../../../../core/ai/providers/types.ts";

type CompiledGraph = ReturnType<typeof compileGraph>;
type FinalState = Record<string, any>;

type LoadedGraph =
  | {
    abstraction: LangGraphAbstraction;
    graphId: number;
    orchestrator: { provider: string; model: string; keyId?: string } | null;
  }
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
  return {
    abstraction,
    graphId: record.id,
    orchestrator: record.orchestrator ?? null,
  };
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
  signal?: AbortSignal,
): Promise<FinalState> {
  const initialInputs = {
    input: "",
    cwd: Deno.cwd(),
    os: Deno.build.os,
    ...inputState,
  };

  let finalState: FinalState = {};
  const events = await app.streamEvents(initialInputs, {
    version: "v2",
    recursionLimit: EXECUTION_RECURSION_LIMIT,
    signal,
  });
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
  run: RunInfo,
) {
  const iteration = (await repo.countHistories(executionId)) + 1;

  const history = await repo.createHistory({
    executionId,
    iteration,
    result: JSON.stringify({ result: finalState.result, finalState, run }),
    version: graphId,
    createdAt: Date.now(),
  });
  await repo.update(executionId, { lastResultId: history.id });

  return { historyId: history.id, iteration };
}

async function linkUsageToRun(
  db: AppDatabase,
  groupId: string,
  historyId: number,
): Promise<void> {
  try {
    await new ModelUsageRepository(db).attachHistory(groupId, historyId);
  } catch (error) {
    console.error("[Usage] Could not link the calls to the run:", error);
  }
}

/**
 * The visual-builder result can report files a plugin wrote to the user's
 * real filesystem (ExecutionResult.files, absolute paths — not managed by
 * Hive). To make "files this run produced" visible/downloadable from the
 * execution history, copy their bytes into attachment storage as "output"
 * attachments linked to this run's history id.
 */
async function captureOutputAttachments(
  dataDir: string,
  attachmentRepo: AttachmentRepository,
  executionId: number,
  historyId: number,
  finalState: FinalState,
): Promise<void> {
  const files = (finalState.result as { files?: Array<{ name: string; path: string; mimeType?: string }> } | undefined)
    ?.files;
  if (!files || files.length === 0) return;

  for (const file of files) {
    try {
      const bytes = await Deno.readFile(file.path);
      const storagePath = await saveAttachment(dataDir, bytes, file.name);
      await attachmentRepo.create({
        chatId: null,
        messageId: null,
        executionId,
        executionHistoryId: historyId,
        direction: "output",
        originalName: file.name,
        mimeType: file.mimeType ?? "application/octet-stream",
        sizeBytes: bytes.length,
        storagePath,
        extractedTextPath: null,
        status: "ready",
        createdAt: Date.now(),
      });
    } catch (error) {
      console.error(
        `[Attachments] Could not capture output file '${file.path}':`,
        error,
      );
    }
  }
}

/**
 * Input attachments the user picked in the "Start Execution" modal are only
 * persisted as rows linked to the execution — the run never saw their bytes.
 * Reuse the same chat pipeline (image -> base64 part, PDF/text -> extracted
 * text part) so the llm nodes receive the file the same way the chat does.
 */
async function resolveInputAttachments(
  db: AppDatabase,
  hive: HiveMicrokernel,
  attachmentIds: number[],
  send: SseSend,
): Promise<Record<string, unknown>> {
  if (attachmentIds.length === 0) return {};

  const config = hive.getConfig();
  const modelRef = normalizeModelRef(config.get("model"), {
    provider: config.get("modelProvider"),
    keyId: config.get("modelKeyId"),
  });

  const { parts } = await buildAttachmentContent(
    config.get("dataDir"),
    new AttachmentRepository(db),
    attachmentIds,
    modelRef,
  );

  return parts.length > 0 ? { attachments: parts } : {};
}

const EXECUTION_RECURSION_LIMIT = 60;

export async function runExecution(
  db: AppDatabase,
  hive: HiveMicrokernel,
  id: number,
  inputState: Record<string, unknown> | undefined,
  headers: Record<string, string>,
  autoApprove = true,
  signal?: AbortSignal,
  attachmentIds: number[] = [],
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

    const { abstraction, graphId, orchestrator: recordedOrchestrator } = loaded;
    applyDefaultModel(abstraction, hive);
    const { problems, warnings } = await checkGraphModels(
      abstraction,
      defaultModelCheckDeps(),
    );
    if (problems.length > 0) {
      return ResponseBuilder.error(
        problems.map((p) => p.reason),
        { problems },
        { headers, status: 422 },
      );
    }
    const app = compileExecutionGraph(hive, abstraction);
    const keys = new ApiKeyRepository(db);
    const findKeyAlias = async (keyId: string) =>
      (await keys.findById(keyId))?.alias;
    const orchestrator = await resolveOrchestrator(
      recordedOrchestrator,
      getCurrentModelRef(hive.getConfig()),
      findKeyAlias,
    );
    const nodes = await snapshotNodes(abstraction, findKeyAlias);

    return createSseResponse(headers, (send) =>
      executionContextStorage.run({ autoApprove }, () =>
        withUsageContext(
          { kind: "execution", role: "delegate", executionId: id },
          async (usageGroupId) => {
            if (warnings.length > 0) send("warning", { warnings });
            let resolvedInputState = inputState;
            try {
              const attachmentState = await resolveInputAttachments(
                db,
                hive,
                attachmentIds,
                send,
              );
              if (Object.keys(attachmentState).length > 0) {
                resolvedInputState = { ...inputState, ...attachmentState };
              }
            } catch (error) {
              send("error", {
                message:
                  error instanceof Error
                    ? error.message
                    : "Could not read an attachment.",
              });
              return;
            }
            const startedAt = Date.now();
            const finalState = await streamRun(app, resolvedInputState, send, signal);
            const endedAt = Date.now();
            finalizeExecutionResult(finalState, abstraction.nodes);

            const { historyId, iteration } = await saveRun(
              repo,
              id,
              graphId,
              finalState,
              {
                startedAt,
                endedAt,
                durationMs: endedAt - startedAt,
                orchestrator,
                nodes,
                input: inputState ?? null,
              },
            );
            await linkUsageToRun(db, usageGroupId, historyId);
            await captureOutputAttachments(
              hive.getConfig().get("dataDir"),
              new AttachmentRepository(db),
              id,
              historyId,
              finalState,
            );
            send("done", {
              historyId,
              iteration,
              result: finalState.result,
              finalState,
            });
          },
        ),
      ));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to run execution: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}
