import { tool } from "@langchain/core/tools";
import * as z from "zod";
import { ChatOllama } from "@langchain/ollama";

// Define tools
const searchPlugin = tool(
  () => {
    // const microkernel = HiveMicrokernel.getInstance();
    // return microkernel
    //   .getRegisteredPlugins()
    //   .map((p) => JSON.stringify(p))
    //   .join("\n");

    return ''
  },
  {
    name: "list_registered_plugins",
    description:
      "Lists the bees (plugins) currently registered in the hive, returning their name and description.",
  },
);

const executePlugin = tool(
  async ({ name, prompt, model }) => {
    // const microkernel = HiveMicrokernel.getInstance();
    // const answer = await microkernel.execute(name, { prompt, model });
    // return answer;
    return ''
  },
  {
    name: "execute_plugin",
    description:
      "Executes a registered plugin by name, passing a prompt and model, and returns the plugin's answer.",
    schema: z.object({
      name: z.string().describe("Name of the registered plugin to execute"),
      prompt: z.string().describe("Prompt to send to the plugin"),
      model: z.string().describe("LLM model to use for the plugin execution"),
    }),
  },
);

// Augment the LLM with tools
export const toolsByName = {
  [executePlugin.name]: executePlugin,
  [searchPlugin.name]: searchPlugin,
};

const tools = Object.values(toolsByName);

export const bindTools = (model: ChatOllama) => model.bindTools(tools);
