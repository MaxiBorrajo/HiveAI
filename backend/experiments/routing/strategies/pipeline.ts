import { ChatOllama } from "@langchain/ollama";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { AIMessage } from "@langchain/core/messages";
import z from "zod";
import { PARAMETRIZADOR_PROMPT, SELECTOR_PROMPT } from "../constants.ts";
import type { MockPlugin } from "../mock-plugins.ts";

export interface PipelineResult {
  selectedName: string | null;
  params: Record<string, unknown> | null;
  abstained: boolean;
  formatError: boolean;
  selectorRaw: AIMessage;
  parametrizadorRaw: AIMessage | null;
}

const serializeCatalog = (catalog: MockPlugin[]) =>
  catalog
    .map(({ schema, ...rest }) =>
      JSON.stringify({ ...rest, parameters: schema.toJSONSchema() }),
    )
    .join("\n");

export async function pipelineCalling(
  query: string,
  model: string,
  catalog: MockPlugin[],
): Promise<PipelineResult> {
  const possiblePlugins = [...catalog.map((c) => c.name), "NONE"];
  const SelectorResponse = z.enum(possiblePlugins);

  const selectorModel = new ChatOllama({
    model,
    think: false,
    numCtx: 8192,
    temperature: 0.0,
    format: z.toJSONSchema(SelectorResponse),
  });

  const selectorRaw = await selectorModel.invoke([
    new SystemMessage(SELECTOR_PROMPT),
    new HumanMessage(
      `HERRAMIENTAS DISPONIBLES\n\n${serializeCatalog(
        catalog,
      )}\n\nPEDIDO DEL USUARIO\n\n${query}`,
    ),
  ]);

  let selectedName: string;

  try {
    selectedName = JSON.parse(selectorRaw.content as string);
  } catch {
    return {
      selectedName: null,
      params: null,
      abstained: false,
      formatError: true,
      selectorRaw,
      parametrizadorRaw: null,
    };
  }

  if (selectedName === "NONE") {
    return {
      selectedName: null,
      params: null,
      abstained: true,
      formatError: false,
      selectorRaw,
      parametrizadorRaw: null,
    };
  }

  const selectedPlugin = catalog.find((c) => c.name === selectedName);

  if (!selectedPlugin) {
    return {
      selectedName,
      params: null,
      abstained: false,
      formatError: false,
      selectorRaw,
      parametrizadorRaw: null,
    };
  }

  const parametrizadorModel = new ChatOllama({
    model,
    think: false,
    temperature: 0.0,
    numCtx: 8192,
    format: z.toJSONSchema(selectedPlugin.schema),
  });

  const parametrizadorRaw = await parametrizadorModel.invoke([
    new SystemMessage(PARAMETRIZADOR_PROMPT),
    new HumanMessage(
      `HERRAMIENTA SELECCIONADA\n\n${selectedPlugin.name}\n${selectedPlugin.description}\nParámetros:\n${JSON.stringify(
        selectedPlugin.schema.toJSONSchema(),
      )}\n\nPEDIDO DEL USUARIO\n\n${query}`,
    ),
  ]);

  try {
    return {
      selectedName,
      params: JSON.parse(parametrizadorRaw.content as string),
      abstained: false,
      formatError: false,
      selectorRaw,
      parametrizadorRaw,
    };
  } catch {
    return {
      selectedName,
      params: null,
      abstained: false,
      formatError: true,
      selectorRaw,
      parametrizadorRaw,
    };
  }
}
