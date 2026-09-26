import { join, isAbsolute } from "node:path";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../../infrastructure/db/repositories/ExecutionRepository.ts";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import {
  compileGraph,
  buildStateSchema,
} from "../../../../core/ai/visual-builder/compiler.ts";
import type {
  LangGraphAbstraction,
  NodeRegistry,
  ToolProvider,
  ExecutionResult,
  GraphNode,
} from "../../../../core/ai/visual-builder/types.ts";

function inferMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "md": return "text/markdown";
    case "json": return "application/json";
    case "txt": return "text/plain";
    case "html": case "htm": return "text/html";
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "svg": return "image/svg+xml";
    case "csv": return "text/csv";
    case "pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}

export function normalizeExecutionResult(
  finalState: Record<string, any>,
  nodes: GraphNode[],
): ExecutionResult {
  const rawResult = finalState.result;

  // 1. If result is already a compliant ExecutionResult object, pass it through
  if (
    rawResult &&
    typeof rawResult === "object" &&
    typeof rawResult.type === "string" &&
    "content" in rawResult
  ) {
    return rawResult as ExecutionResult;
  }

  // 2. Check if a file was created/written (file_ops node or output string)
  const fileOpsNode = nodes.find(
    (n) => n.type === "plugin" && n.config?.pluginId === "file_ops",
  );

  const fileMatch =
    typeof rawResult === "string"
      ? rawResult.match(/(?:Wrote\s+\d+\s+chars\s+to|Created\s+file):\s*([^\r\n]+)/i)
      : null;

  if (fileMatch || fileOpsNode) {
    const rawPath = fileMatch
      ? fileMatch[1].trim()
      : (fileOpsNode?.config?.inputMapping as any)?.path || "output.txt";
    const cleanPath = rawPath.replace(
      /^(?:\/?absolute\/path\/to\/|\/?current\/working\/directory\/|\/?path\/to\/)/i,
      "",
    );
    const fullPath = isAbsolute(cleanPath) ? cleanPath : join(Deno.cwd(), cleanPath);
    const fileName = cleanPath.split(/[\/\\]/).pop() || cleanPath;

    // Find the primary content written to this file
    const contentKey = (fileOpsNode?.config?.inputMapping as any)?.content;
    let fileContent: any = "";
    if (typeof contentKey === "string" && contentKey.startsWith("${") && contentKey.endsWith("}")) {
      fileContent = finalState[contentKey.slice(2, -1)];
    } else if (typeof contentKey === "string" && finalState[contentKey] !== undefined) {
      fileContent = finalState[contentKey];
    } else {
      const candidateKey = Object.keys(finalState).find(
        (k) =>
          !["input", "messages", "feedback", "attempts", "model", "result"].includes(k) &&
          typeof finalState[k] === "string" &&
          finalState[k].length > 50,
      );
      fileContent = candidateKey ? finalState[candidateKey] : rawResult;
    }

    const size = typeof fileContent === "string" ? fileContent.length : undefined;

    return {
      type: "file",
      summary: `Archivo '${fileName}' generado y guardado en disco.`,
      content: fileContent || rawResult,
      files: [
        {
          name: fileName,
          path: fullPath,
          size,
          mimeType: inferMimeType(fileName),
        },
      ],
      metadata: {
        nodeId: fileOpsNode?.id,
        operation: (fileOpsNode?.config?.inputMapping as any)?.operation || "write",
      },
    };
  }

  // 3. Boolean Decision
  if (typeof rawResult === "boolean") {
    return {
      type: "boolean",
      summary: rawResult
        ? "Condición evaluada como Verdadera (True)."
        : "Condición evaluada como Falsa (False).",
      content: rawResult,
    };
  }

  // 4. Tabular Data / List
  if (Array.isArray(rawResult)) {
    const isTabular =
      rawResult.length > 0 &&
      typeof rawResult[0] === "object" &&
      rawResult[0] !== null;
    return {
      type: isTabular ? "table" : "json",
      summary: `Colección de ${rawResult.length} registros obtenidos.`,
      content: rawResult,
    };
  }

  // 5. Structured JSON Object
  if (typeof rawResult === "object" && rawResult !== null) {
    return {
      type: "json",
      summary: "Estructura de datos JSON generada.",
      content: rawResult,
    };
  }

  // 6. Shell / Terminal Output
  const lastTerminalNode = nodes.find(
    (n) => n.type === "plugin" && n.config?.pluginId === "run_shell",
  );
  if (
    typeof rawResult === "string" &&
    lastTerminalNode &&
    nodes[nodes.length - 1]?.id === lastTerminalNode.id
  ) {
    return {
      type: "terminal",
      summary: "Comando de terminal ejecutado.",
      content: rawResult,
      metadata: {
        command: (lastTerminalNode.config?.inputMapping as any)?.command,
      },
    };
  }

  // 7. Markdown vs Plain Text
  if (typeof rawResult === "string") {
    const isMarkdown =
      rawResult.includes("#") ||
      rawResult.includes("**") ||
      rawResult.includes("```") ||
      rawResult.includes("\n- ") ||
      rawResult.includes("\n1. ") ||
      rawResult.includes("|");

    return {
      type: isMarkdown ? "markdown" : "text",
      summary: isMarkdown ? "Documento formateado generado con éxito." : "Texto generado con éxito.",
      content: rawResult,
    };
  }

  return {
    type: "text",
    summary: "Ejecución completada.",
    content: String(rawResult ?? ""),
  };
}

export async function runExecution(
  db: AppDatabase,
  hive: HiveMicrokernel,
  id: number,
  inputState: any,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    const repo = new ExecutionRepository(db);
    const execution = await repo.findById(id);
    if (!execution || !execution.lastGraphId) {
      return ResponseBuilder.error(
        ["Execution or graph not found"],
        undefined,
        {
          headers,
          status: 404,
        },
      );
    }

    const graphRecord = await repo.findGraphById(execution.lastGraphId);
    if (!graphRecord) {
      return ResponseBuilder.error(["Graph record not found"], undefined, {
        headers,
        status: 404,
      });
    }

    let parsedGraph = graphRecord.graph as any;
    let parsedState = graphRecord.state as any;

    if (typeof parsedGraph === "string") {
      try {
        parsedGraph = JSON.parse(parsedGraph);
      } catch (e) {}
    }
    if (typeof parsedState === "string") {
      try {
        parsedState = JSON.parse(parsedState);
      } catch (e) {}
    }

    const abstraction = {
      nodes: parsedGraph.nodes,
      edges: parsedGraph.edges,
      stateSchema: parsedState,
    } as LangGraphAbstraction;

    const schema = buildStateSchema(abstraction.stateSchema);

    // Custom logic registry
    const registry: NodeRegistry = {
      plugin: async (state, config) => {
        const toolName = config.pluginId as string;
        const tool = hive.getTool(toolName);
        if (!tool) throw new Error(`Tool ${toolName} not found`);
        
        const inputMapping = (config.inputMapping as Record<string, string>) || {};
        let inputToTool: any = {};
        
        for (const [key, rawMapping] of Object.entries(inputMapping)) {
           let mapping: any = rawMapping;
           if (typeof mapping === "object" && mapping !== null && "value" in mapping) {
              mapping = (mapping as any).value;
           }
           if (typeof mapping === "string" && mapping.startsWith("${") && mapping.endsWith("}")) {
              const varName = mapping.slice(2, -1);
              inputToTool[key] = state[varName] !== undefined ? state[varName] : state[mapping] !== undefined ? state[mapping] : mapping;
           } else if (typeof mapping === "string" && state[mapping] !== undefined) {
              inputToTool[key] = state[mapping];
           } else {
              inputToTool[key] = mapping;
           }
        }
        
        // If tool takes a single primitive, pass it directly if we have exactly one key
        const keys = Object.keys(inputToTool);
        let finalInput = inputToTool;
        if (keys.length === 1 && typeof inputToTool[keys[0]] === "string") {
           // We'll pass the object, LangChain's DynamicTool usually handles JSON or string.
           // Let's pass the single string if that's what tools expect in this codebase
           finalInput = inputToTool[keys[0]];
        }
        
        console.log(`[Plugin Executor] Running ${toolName} with input:`, finalInput);
        const result = await tool.invoke(inputToTool); // passing the object just in case
        
        const outputKey = (config.outputKey as string) || toolName;
        return { [outputKey]: result };
      }
    };
    const toolProvider: ToolProvider = {
      getTool: (name: string) => {
        const tool = hive.getTool(name);
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool;
      },
    };

    const app = compileGraph(abstraction, schema, registry, toolProvider);

    const streamHeaders = {
      ...headers,
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    };

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        };

        try {
          const initialInputs = { input: "", ...(inputState || {}) };
          const events = await app.streamEvents(initialInputs, {
            version: "v2",
          });
          let finalState: Record<string, any> = {};

          for await (const event of events) {
            send(event.event, event);
            if (event.event === "on_chain_end" && event.name === "LangGraph") {
              finalState = event.data.output || {};
            }
          }

          // Guarantee state.result is always populated and standardized
          if (finalState.result === undefined) {
            const skipKeys = new Set(["input", "messages", "feedback", "attempts", "model"]);
            const candidateKey =
              Object.keys(finalState).find(
                (k) => !skipKeys.has(k) && typeof finalState[k] !== "boolean",
              ) || Object.keys(finalState).find((k) => !skipKeys.has(k));

            if (candidateKey) {
              finalState.result = finalState[candidateKey];
            } else {
              finalState.result = "Workflow executed successfully.";
            }
          }

          // Enforce standardized ExecutionResult contract defined by graph and endNode
          const endNode = abstraction.nodes.find((n) => n.type === "end");
          const outputSpec = (endNode?.config?.output || endNode?.config) as any;

          let normalizedResult: ExecutionResult;
          if (outputSpec && outputSpec.type) {
            let content = outputSpec.contentKey ? finalState[outputSpec.contentKey] : undefined;
            if (
              content === undefined &&
              typeof outputSpec.contentKey === "string" &&
              outputSpec.contentKey.startsWith("${") &&
              outputSpec.contentKey.endsWith("}")
            ) {
              content = finalState[outputSpec.contentKey.slice(2, -1)];
            }
            if (content === undefined) {
              content = finalState.result;
            }

            const resolvedFiles = outputSpec.files?.map((f: any) => {
              const rawPath = f.path || f.name || "output";
              const cleanPath = rawPath.replace(
                /^(?:\/?absolute\/path\/to\/|\/?current\/working\/directory\/|\/?path\/to\/)/i,
                "",
              );
              const fullPath = isAbsolute(cleanPath)
                ? cleanPath
                : join(Deno.cwd(), cleanPath);
              return {
                ...f,
                name: f.name || cleanPath.split("/").pop() || "file",
                path: fullPath,
                mimeType: f.mimeType || inferMimeType(cleanPath),
              };
            });

            normalizedResult = {
              type: outputSpec.type,
              summary: outputSpec.summary || "Workflow deliverable completed successfully.",
              content,
              files: resolvedFiles,
              metadata: outputSpec.metadata,
            };
          } else {
            normalizedResult = normalizeExecutionResult(finalState, abstraction.nodes);
          }

          finalState.result = normalizedResult;

          const iterationCount = await repo.countHistories(id);
          const currentIteration = iterationCount + 1;

          // Save history record with both deliverable result and complete finalState
          const historyPayload = {
            result: finalState.result,
            finalState,
          };

          const historyRecord = await repo.createHistory({
            executionId: id,
            iteration: currentIteration,
            result: JSON.stringify(historyPayload),
            version: graphRecord.id,
            createdAt: Date.now(),
          });

          await repo.update(id, { lastResultId: historyRecord.id });

          send("done", {
            historyId: historyRecord.id,
            iteration: currentIteration,
            result: finalState.result,
            finalState,
          });
          controller.close();
        } catch (err: any) {
          send("error", { error: err.message });
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: streamHeaders });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to run execution: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}
