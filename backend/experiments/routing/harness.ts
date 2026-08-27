import { MOCK_PLUGINS } from "./mock-plugins.ts";
import type { RoutingQuery } from "./queries.ts";
import { pipelineCalling } from "./strategies/pipeline.ts";
import { toolCalling } from "./strategies/tool-calling.ts";
import { evaluate } from "./evaluate.ts";
import { normalize } from "./normalize.ts";
import {
  AIMessageChunk,
  MessageStructure,
  MessageToolSet,
} from "@langchain/core/messages";

export async function harness(
  query: RoutingQuery,
  pluginsSize: number,
  strategy: "tool-calling" | "pipeline",
  repetitionsPerQuery: number,
) {
  if (pluginsSize <= 0) {
    console.error(
      "El tamaño del catalogo de plugins no puede ser menor o igual a cero",
    );
    return;
  }
  const minimalCatalogOfPlugins = MOCK_PLUGINS.slice(0, pluginsSize);

  if (
    query.expected_plugin &&
    !minimalCatalogOfPlugins.find((p) => p.name === query.expected_plugin)
  ) {
    console.error(
      "La consulta espera un plugin que quedó fuera del catálogo recortado",
    );
    return;
  }

  const validationResults = [];

  for (let index = 0; index < repetitionsPerQuery; index++) {
    let results = [];

    if (strategy === "tool-calling") {
      results.push(await toolCalling(query.query, minimalCatalogOfPlugins));
    } else {
      results.push(await pipelineCalling(query.query, minimalCatalogOfPlugins));
    }

    for (const result of results) {
      const normalizeResult = normalize(
        result as AIMessageChunk<MessageStructure<MessageToolSet>>,
      );
      validationResults.push(
        evaluate(
          normalizeResult,
          query,
          minimalCatalogOfPlugins,
          strategy,
          pluginsSize,
          repetitionsPerQuery,
        ),
      );
    }
  }

  return validationResults;
}
