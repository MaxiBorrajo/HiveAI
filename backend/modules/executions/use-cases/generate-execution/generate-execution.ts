import { createSseResponse } from "../../../../core/api/sse.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/execution-repository.ts";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { generateIncrementalGraph } from "../../../../core/ai/visual-builder/generation/generate-graph.ts";
import type {
  IncrementalEvent,
  LangGraphAbstraction,
} from "../../../../core/ai/visual-builder/types.ts";
import { parseMaybeJson } from "../../parse-maybe-json.ts";
import { describeActivePlugins } from "./describe-plugins.ts";

const LOG = "[Executions Generator]";
const MAX_NAME_LENGTH = 50;
const MAX_PROMPT_LOG_LENGTH = 100;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

async function loadCurrentGraph(
  repo: ExecutionRepository,
  executionId: number,
): Promise<LangGraphAbstraction | undefined> {
  const execution = await repo.findById(executionId);
  if (!execution?.lastGraphId) return undefined;

  const record = await repo.findGraphById(execution.lastGraphId);
  if (!record) return undefined;

  const graph = parseMaybeJson(record.graph) as LangGraphAbstraction;
  console.log(
    `${LOG} Loaded graph #${record.id} of execution #${executionId}: ${
      graph.nodes?.length ?? 0
    } nodes, ${graph.edges?.length ?? 0} edges.`,
  );
  return graph;
}

async function resolveExecutionId(
  repo: ExecutionRepository,
  executionId: number | undefined,
  prompt: string,
): Promise<number> {
  if (executionId) return executionId;

  const created = await repo.create({
    name: prompt.substring(0, MAX_NAME_LENGTH) +
      (prompt.length > MAX_NAME_LENGTH ? "..." : ""),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  console.log(`${LOG} Created execution #${created.id}: "${created.name}"`);
  return created.id;
}

function logStreamEvent(event: IncrementalEvent): void {
  switch (event.type) {
    case "planning":
      console.log(`${LOG} [planning] "${event.thoughts}"`);
      break;
    case "node_added":
      console.log(
        `${LOG} [node_added] "${event.node.name}" (${event.node.id}, ${event.node.type})${
          event.edge ? ` <- "${event.edge.source}"` : ""
        }`,
      );
      break;
    case "edge_added":
      console.log(
        `${LOG} [edge_added] "${event.edge.id}": "${event.edge.source}" -> "${event.edge.target}"`,
      );
      break;
  }
}

async function saveGeneratedGraph(
  repo: ExecutionRepository,
  executionId: number,
  graph: LangGraphAbstraction,
) {
  const saved = await repo.createGraph({
    executionId,
    graph,
    state: graph.stateSchema,
    createdAt: Date.now(),
  });
  await repo.update(executionId, { lastGraphId: saved.id });
  console.log(`${LOG} Saved graph #${saved.id} for execution #${executionId}.`);
  return saved;
}

export async function generateExecution(
  db: AppDatabase,
  model: string,
  hive: HiveMicrokernel,
  content: string | undefined,
  executionId: number | undefined,
  targetNodeId: string | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  return createSseResponse(headers, async (send) => {
    if (!content) {
      send("error", { message: "Missing 'content' in request body." });
      return;
    }

    console.log(
      `${LOG} Model: "${model}" | Execution: ${executionId ?? "new"} | Target node: ${
        targetNodeId ?? "none"
      } | Prompt: "${truncate(content, MAX_PROMPT_LOG_LENGTH)}"`,
    );

    const repo = new ExecutionRepository(db);
    const currentGraph = executionId
      ? await loadCurrentGraph(repo, executionId)
      : undefined;
    const targetExecutionId = await resolveExecutionId(repo, executionId, content);

    send("execution_created", { executionId: targetExecutionId });

    const generator = generateIncrementalGraph(
      content,
      model,
      describeActivePlugins(hive),
      currentGraph,
      targetNodeId,
    );

    let result = await generator.next();
    while (!result.done) {
      logStreamEvent(result.value);
      send(result.value.type, result.value);
      result = await generator.next();
    }
    const finalGraph: LangGraphAbstraction | null = result.value ?? null;
    if (!finalGraph) return;

    const saved = await saveGeneratedGraph(repo, targetExecutionId, finalGraph);
    send("done", {
      executionId: targetExecutionId,
      graphId: saved.id,
      graph: finalGraph,
    });
  });
}
