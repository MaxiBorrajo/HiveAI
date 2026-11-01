import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ResponseBuilder } from "../../../core/api/response.ts";
import type {
  GraphNode,
  LangGraphAbstraction,
} from "../../../core/ai/visual-builder/types.ts";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import type { AppDatabase } from "../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../infrastructure/db/repositories/execution-repository.ts";
import { saveToDownloads } from "../../../core/files/save-to-downloads.ts";
import { listExportablePluginFiles } from "../../../core/files/zip-folder.ts";
import { BlobWriter, ZipWriter } from "@zip-js/zip-js";
import { parseMaybeJson } from "../parse-maybe-json.ts";
import {
  CURRENT_VERSION,
  FLOW_JSON_NAME,
  FORMAT_NAME,
  type FlowFile,
  MAX_PLUGIN_BYTES,
  PLUGINS_DIR,
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

async function readPluginFiles(
  dir: string,
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  for (const name of await listExportablePluginFiles(dir)) {
    const content = new Uint8Array(await readFile(join(dir, name)));
    total += content.byteLength;
    if (total > MAX_PLUGIN_BYTES) {
      throw new Error("A plugin is too large to be bundled in a flow file.");
    }
    files[name] = content;
  }
  return files;
}

export function safeFlowFilename(name: string): string {
  const stem = name
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, MAX_FILENAME_STEM)
    .replace(/^_+|_+$/g, "");
  return `${stem || "flow"}.hiveai-flow.zip`;
}

export async function exportFlow(
  db: AppDatabase,
  hive: HiveMicrokernel,
  id: number,
  headers: Record<string, string>,
  options: {
    confirmSecrets?: boolean;
    /** Where the zip goes; defaults to the user's Downloads folder. */
    save?: (filename: string, bytes: Uint8Array) => Promise<string>;
  } = {},
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

    // Exporting writes a file to disk, so secrets are reported first and the
    // caller must confirm before anything is saved.
    const secretWarnings = scanGraphForSecrets(graph);
    if (secretWarnings.length > 0 && !options.confirmSecrets) {
      return ResponseBuilder.success(
        { saved: false, secretWarnings },
        { headers },
      );
    }

    const bundledPlugins: Record<string, Record<string, Uint8Array>> = {};
    for (const { name, external } of requiredPlugins) {
      if (!external) continue;
      const dir = await hive.getExternalPluginDir(name);
      if (!dir) continue;
      bundledPlugins[name] = await readPluginFiles(dir);
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
    };

    const zipWriter = new ZipWriter(new BlobWriter("application/zip"));
    await zipWriter.add(
      FLOW_JSON_NAME,
      new Blob([JSON.stringify(file, null, 2)]).stream(),
    );
    for (const [pluginName, files] of Object.entries(bundledPlugins)) {
      for (const [fileName, content] of Object.entries(files)) {
        await zipWriter.add(
          `${PLUGINS_DIR}/${pluginName}/${fileName}`,
          new Blob([content as Uint8Array<ArrayBuffer>]).stream(),
        );
      }
    }
    const zip = await zipWriter.close();

    const path = await (options.save ?? saveToDownloads)(
      safeFlowFilename(execution.name),
      new Uint8Array(await zip.arrayBuffer()),
    );

    return ResponseBuilder.success(
      { saved: true, path, secretWarnings },
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
