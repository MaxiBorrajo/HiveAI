import { Ollama } from "ollama";
import { invalidateLocalNumCtx } from "../../../core/ai/providers/local-context.ts";
import { fetchModelInfo } from "../../models/use-cases/get-model-info.ts";
import { PullManager, type PullClient } from "./pull-manager.ts";

export const MAX_PARALLEL_PULLS = 2;

let instance: PullManager | undefined;

export function getPullManager(): PullManager {
  instance ??= new PullManager({
    maxParallel: MAX_PARALLEL_PULLS,
    // one client per pull: Ollama#abort() cancels every stream of that instance
    createClient: () => new Ollama() as unknown as PullClient,
    listInstalled: async () => {
      try {
        return (await new Ollama().list()).models.map((m) => m.name);
      } catch {
        return null;
      }
    },
    deleteModel: async (name) => {
      await new Ollama().delete({ model: name });
    },
    onCompleted: async (name) => {
      invalidateLocalNumCtx(name);
      return (await fetchModelInfo(name))?.capabilities;
    },
  });
  return instance;
}
