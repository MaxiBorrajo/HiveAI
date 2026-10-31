import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ResponseBuilder } from "../../../core/api/response.ts";
import type {
  GraphNode,
  LangGraphAbstraction,
} from "../../../core/ai/visual-builder/types.ts";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import type { AppDatabase } from "../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../infrastructure/db/repositories/execution-repository.ts";
import { parseMaybeJson } from "../parse-maybe-json.ts";
import {
  CURRENT_VERSION,
  FORMAT_NAME,
  type FlowFile,
  MAX_PLUGIN_BYTES,
} from "./flow-format.ts";
import { collectRequiredPlugins } from "./plugin-refs.ts";
import { scanGraphForSecrets } from "./scan-secrets.ts";

const MAX_FILENAME_STEM = 40;

/** Local key ids mean nothing on another installation and must not travel. */
function stripKeyIds(nodes: GraphNode[]): GraphNode[] {
  return nodes.map((node) => {
    const config = { ...(node.config ?? {}) } as Record<string, unknown>;
    delete config.keyId;
    return { ...node, config } as GraphNode;
  });
}

async function readPluginFiles(dir: string): Promise<Record<string, string>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: Record<string, string> = {};
  let total = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const content = await readFile(join(dir, entry.name), "utf-8");
    total += content.length;
    if (total > MAX_PLUGIN_BYTES) {
      throw new Error("A plugin is too large to be bundled in a flow file.");
    }
    files[entry.name] = content;
  }
  return files;
}

export function safeFlowFilename(name: string): string {
  const stem = name
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, MAX_FILENAME_STEM)
    .replace(/^_+|_+$/g, "");
  return `${stem || "flow"}.hiveai-flow.json`;
}

export async function exportFlow(
  db: AppDatabase,
  hive: HiveMicrokernel,
  id: number,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const repo = new ExecutionRepository(db);
    const execution = await repo.findById(id);
    const record = execution?.lastGraphId
      ? await repo.findGraphById(execution.lastGraphId)
      : undefined;
    if (!execution || !record) {
      return ResponseBuilder.error(["Execution not found"], undefined, {
        headers,
        status: 404,
      });
    }

    const rawGraph = parseMaybeJson(record.graph) as LangGraphAbstraction;
    const graph: LangGraphAbstraction = {
      nodes: stripKeyIds(rawGraph.nodes),
      edges: rawGraph.edges,
      stateSchema: parseMaybeJson(
        record.state,
      ) as LangGraphAbstraction["stateSchema"],
    };

    const requiredPlugins = collectRequiredPlugins(graph).map((name) => ({
      name,
      external: hive.isExternalPlugin(name),
    }));

    const bundledPlugins: FlowFile["bundledPlugins"] = [];
    for (const { name, external } of requiredPlugins) {
      if (!external) continue;
      const dir = await hive.getExternalPluginDir(name);
      if (!dir) continue;
      bundledPlugins.push({ name, files: await readPluginFiles(dir) });
    }

    const orchestrator = record.orchestrator
      ? {
        provider: record.orchestrator.provider,
        model: record.orchestrator.model,
      }
      : null;

    const file: FlowFile = {
      format: FORMAT_NAME,
      formatVersion: CURRENT_VERSION,
      kind: "execution",
      exportedAt: new Date().toISOString(),
      name: execution.name,
      graph,
      orchestrator,
      requiredPlugins,
      bundledPlugins,
    };

    return ResponseBuilder.success(
      {
        filename: safeFlowFilename(execution.name),
        file,
        secretWarnings: scanGraphForSecrets(graph),
      },
      { headers },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to export execution: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}
