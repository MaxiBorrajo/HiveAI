import { MOCK_PLUGINS } from "./mock-plugins.ts";
import type { RoutingQuery } from "./queries.ts";
import { pipelineCalling } from "./strategies/pipeline.ts";
import { toolCalling } from "./strategies/tool-calling.ts";
import { PEV } from "./strategies/plan-execution-verification.ts";
import { evaluate } from "./evaluate.ts";
import { normalize } from "./normalize.ts";

export async function harness(
  query: RoutingQuery,
  model: string,
  pluginsSize: number,
  strategy:
    | "tool-calling"
    | "pipeline"
    | "plan-execution-verification"
    | "plan-execution-verification-granite-selector",
  repetitionsPerQuery: number,
  selectorModel?: string,
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
    try {
      const result =
        strategy === "tool-calling"
          ? await toolCalling(query.query, model, minimalCatalogOfPlugins)
          : strategy === "pipeline"
            ? await pipelineCalling(query.query, model, minimalCatalogOfPlugins)
            : await PEV(
                query.query,
                model,
                minimalCatalogOfPlugins,
                selectorModel,
              );

      validationResults.push(
        evaluate(
          normalize(result),
          query,
          model,
          minimalCatalogOfPlugins,
          strategy,
          pluginsSize,
          index + 1,
          false,
          selectorModel
        ),
      );
    } catch (error) {
      // Una repetición que revienta (modelo caído, stream cortado) no puede
      // tirar abajo la corrida entera: la salteamos y seguimos.
      console.error(
        `Falló la repetición ${index + 1} de ${query.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return validationResults;
}
