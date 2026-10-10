import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
import { getModels } from "@/features/models/api/getModels";
import { getModelOptions } from "@/features/models/api/getModelOptions";
import { getCurrentModels } from "@/features/models/api/getCurrentModels";
import { setModels as setModelsRequest } from "@/features/models/api/setModels";
import {
  getEmbeddingModelStatus,
  type EmbeddingModelStatus,
} from "@/features/models/api/getEmbeddingModelStatus";
import type {
  CurrentModels,
  ModelInfo,
  ModelOptionGroup,
} from "@/features/models/types";
import type { ModelChoice } from "@/features/models/lib/modelChoices";

interface ModelsContextValue {
  models: ModelInfo[];
  optionGroups: ModelOptionGroup[];
  current: CurrentModels;
  isKeysOpen: boolean;
  openKeys: () => void;
  closeKeys: () => void;
  hasModel: boolean;
  hasAvailableModels: boolean;
  embeddingModelStatus: EmbeddingModelStatus | null;
  isManageOpen: boolean;
  openManage: () => void;
  closeManage: () => void;
  refreshModels: () => void;
  changeModel: (choice: string | ModelChoice) => Promise<void>;
  modeResetSignal: number;
  runBusy: <T>(message: string, task: () => Promise<T>) => Promise<T>;
}

const ModelsContext = createContext<ModelsContextValue | null>(null);

export function ModelsProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [optionGroups, setOptionGroups] = useState<ModelOptionGroup[]>([]);
  const [isKeysOpen, setIsKeysOpen] = useState(false);
  const [current, setCurrent] = useState<CurrentModels>({
    model: "",
    provider: "ollama",
    keyId: "",
  });
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [modeResetSignal, setModeResetSignal] = useState(0);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [embeddingModelStatus, setEmbeddingModelStatus] =
    useState<EmbeddingModelStatus | null>(null);

  async function runBusy<T>(
    message: string,
    task: () => Promise<T>,
  ): Promise<T> {
    setBusyMessage(message);
    try {
      return await task();
    } finally {
      setBusyMessage(null);
    }
  }

  function refreshModels() {
    getModels().then(({ data }) => setModels(data ?? []));
    getModelOptions()
      .then(({ data }) => setOptionGroups(data ?? []))
      .catch(() => setOptionGroups([]));
    getCurrentModels().then(({ data }) => {
      if (data) setCurrent(data);
    });
    getEmbeddingModelStatus().then(({ data }) => {
      if (data) setEmbeddingModelStatus(data);
    });
  }

  useEffect(refreshModels, []);

  async function changeModel(choice: string | ModelChoice) {
    const target: ModelChoice =
      typeof choice === "string"
        ? { provider: "ollama", model: choice, keyId: "" }
        : choice;
    const previous = current;
    setCurrent(target);

    await runBusy("Applying model change...", async () => {
      try {
        const { data } = await setModelsRequest({
          model: target.model,
          provider: target.provider,
          keyId: target.keyId,
        });
        if (data) setCurrent(data);
        setModeResetSignal((n) => n + 1);
      } catch {
        setCurrent(previous);
      }
    });
  }

  const value: ModelsContextValue = {
    models,
    optionGroups,
    current,
    isKeysOpen,
    openKeys: () => setIsKeysOpen(true),
    closeKeys: () => setIsKeysOpen(false),
    hasModel: !!current.model,
    hasAvailableModels: models.length > 0,
    embeddingModelStatus,
    isManageOpen,
    openManage: () => setIsManageOpen(true),
    closeManage: () => setIsManageOpen(false),
    refreshModels,
    changeModel,
    modeResetSignal,
    runBusy,
  };

  return (
    <ModelsContext.Provider value={value}>
      {children}

      {busyMessage && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/70 backdrop-blur-xs">
          <Loader2 className="size-8 animate-spin text-foreground" />
          <p className="max-w-xs text-center text-sm text-foreground">
            {busyMessage}
          </p>
        </div>
      )}
    </ModelsContext.Provider>
  );
}

export function useModels(): ModelsContextValue {
  const context = useContext(ModelsContext);
  if (!context) {
    throw new Error("useModels must be used within a ModelsProvider");
  }
  return context;
}
