import { isAbsolute, join } from "node:path";
import type {
  ExecutionResult,
  GraphNode,
} from "../../../../core/ai/visual-builder/types.ts";

export function resolveFilePath(
  rawPath: string,
): { cleanPath: string; fullPath: string } {
  const cleanPath = rawPath.replace(
    /^(?:\/?absolute\/path\/to\/|\/?current\/working\/directory\/|\/?path\/to\/)/i,
    "",
  );
  const fullPath = isAbsolute(cleanPath)
    ? cleanPath
    : join(Deno.cwd(), cleanPath);
  return { cleanPath, fullPath };
}

export function inferMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "md":
      return "text/markdown";
    case "json":
      return "application/json";
    case "txt":
      return "text/plain";
    case "html":
    case "htm":
      return "text/html";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "svg":
      return "image/svg+xml";
    case "csv":
      return "text/csv";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

export function normalizeExecutionResult(
  finalState: Record<string, any>,
  nodes: GraphNode[],
): ExecutionResult {
  const rawResult = finalState.result;

  if (
    rawResult &&
    typeof rawResult === "object" &&
    typeof rawResult.type === "string" &&
    "content" in rawResult
  ) {
    return rawResult as ExecutionResult;
  }

  const fileOpsNode = nodes.find(
    (n) => n.type === "plugin" && n.config?.pluginId === "file_ops",
  );

  const fileMatch = typeof rawResult === "string"
    ? rawResult.match(
      /(?:Wrote\s+\d+\s+chars\s+to|Created\s+file):\s*([^\r\n]+)/i,
    )
    : null;

  if (fileMatch || fileOpsNode) {
    const rawPath = fileMatch
      ? fileMatch[1].trim()
      : (fileOpsNode?.config?.inputMapping as any)?.path || "output.txt";
    const { cleanPath, fullPath } = resolveFilePath(rawPath);
    const fileName = cleanPath.split(/[\/\\]/).pop() || cleanPath;

    const contentKey = (fileOpsNode?.config?.inputMapping as any)?.content;
    let fileContent: any = "";
    if (
      typeof contentKey === "string" && contentKey.startsWith("${") &&
      contentKey.endsWith("}")
    ) {
      fileContent = finalState[contentKey.slice(2, -1)];
    } else if (
      typeof contentKey === "string" && finalState[contentKey] !== undefined
    ) {
      fileContent = finalState[contentKey];
    } else {
      const candidateKey = Object.keys(finalState).find(
        (k) =>
          !["input", "messages", "feedback", "attempts", "model", "result"]
            .includes(k) &&
          typeof finalState[k] === "string" &&
          finalState[k].length > 50,
      );
      fileContent = candidateKey ? finalState[candidateKey] : rawResult;
    }

    const size = typeof fileContent === "string"
      ? fileContent.length
      : undefined;

    let fileExistsOnDisk = false;
    let actualSize: number | undefined = size;
    try {
      const stat = Deno.statSync(fullPath);
      fileExistsOnDisk = stat.isFile;
      actualSize = stat.size;
    } catch {
      fileExistsOnDisk = false;
    }

    if (fileExistsOnDisk) {
      return {
        type: "file",
        summary: `Archivo '${fileName}' generado y guardado en disco.`,
        content: fileContent || rawResult,
        files: [
          {
            name: fileName,
            path: fullPath,
            size: actualSize,
            mimeType: inferMimeType(fileName),
          },
        ],
        metadata: {
          nodeId: fileOpsNode?.id,
          operation: (fileOpsNode?.config?.inputMapping as any)?.operation ||
            "write",
        },
      };
    }
  }

  if (typeof rawResult === "boolean") {
    return {
      type: "boolean",
      summary: rawResult
        ? "Condition evaluated as True."
        : "Condition evaluated as False.",
      content: rawResult,
    };
  }

  if (Array.isArray(rawResult)) {
    const isTabular = rawResult.length > 0 &&
      typeof rawResult[0] === "object" &&
      rawResult[0] !== null;
    return {
      type: isTabular ? "table" : "json",
      summary: `Retrieved ${rawResult.length} records.`,
      content: rawResult,
    };
  }

  if (typeof rawResult === "object" && rawResult !== null) {
    return {
      type: "json",
      summary: "Structured JSON data generated.",
      content: rawResult,
    };
  }

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
      summary: "Terminal command executed successfully.",
      content: rawResult,
      metadata: {
        command: (lastTerminalNode.config?.inputMapping as any)?.command,
      },
    };
  }

  if (typeof rawResult === "string") {
    const isMarkdown = rawResult.includes("#") ||
      rawResult.includes("**") ||
      rawResult.includes("```") ||
      rawResult.includes("\n- ") ||
      rawResult.includes("\n1. ") ||
      rawResult.includes("|");

    return {
      type: isMarkdown ? "markdown" : "text",
      summary: isMarkdown
        ? "Formatted markdown document generated."
        : "Text content generated successfully.",
      content: rawResult,
    };
  }

  return {
    type: "text",
    summary: "Execution completed.",
    content: String(rawResult ?? ""),
  };
}


export function finalizeExecutionResult(
  finalState: Record<string, any>,
  nodes: GraphNode[],
): ExecutionResult {
  if (finalState.result === undefined) {
    const skipKeys = new Set([
      "input",
      "cwd",
      "os",
      "messages",
      "feedback",
      "attempts",
      "model",
    ]);
    const candidateKey = Object.keys(finalState).find(
      (k) => !skipKeys.has(k) && typeof finalState[k] !== "boolean",
    ) || Object.keys(finalState).find((k) => !skipKeys.has(k));

    if (candidateKey) {
      finalState.result = finalState[candidateKey];
    } else {
      finalState.result = "Workflow executed successfully.";
    }
  }

  const endNode = nodes.find((n) => n.type === "end");
  const outputSpec = (endNode?.config?.output || endNode?.config) as any;

  let normalizedResult: ExecutionResult;
  if (outputSpec && outputSpec.type) {
    let content = outputSpec.contentKey
      ? finalState[outputSpec.contentKey]
      : undefined;
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
      const { cleanPath, fullPath } = resolveFilePath(
        f.path || f.name || "output",
      );
      return {
        ...f,
        name: f.name || cleanPath.split("/").pop() || "file",
        path: fullPath,
        mimeType: f.mimeType || inferMimeType(cleanPath),
      };
    });

    const existingFiles = (resolvedFiles || []).filter((f: any) => {
      try {
        return Deno.statSync(f.path).isFile;
      } catch {
        return false;
      }
    });

    if (outputSpec.type === "file" && existingFiles.length === 0) {
      const booleanVar = Object.keys(finalState).find(
        (k) =>
          typeof finalState[k] === "boolean" &&
          !["input", "cwd", "os"].includes(k),
      );
      const boolVal = booleanVar ? finalState[booleanVar] : undefined;

      normalizedResult = {
        type: booleanVar !== undefined ? "boolean" : "text",
        summary: booleanVar !== undefined
          ? `Workflow completed. Condition '${booleanVar}' = ${boolVal} (file creation skipped).`
          : `Workflow completed without file generation.`,
        content: booleanVar !== undefined ? boolVal : (content || "Completed"),
        metadata: {
          ...outputSpec.metadata,
          skippedFiles: resolvedFiles?.map((f: any) => f.name) || [],
        },
      };
    } else {
      normalizedResult = {
        type: outputSpec.type,
        summary: outputSpec.summary ||
          "Workflow deliverable completed successfully.",
        content,
        files: existingFiles.length > 0 ? existingFiles : resolvedFiles,
        metadata: outputSpec.metadata,
      };
    }
  } else {
    normalizedResult = normalizeExecutionResult(finalState, nodes);
  }

  finalState.result = normalizedResult;
  return normalizedResult;
}
