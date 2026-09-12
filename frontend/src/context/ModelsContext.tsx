import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
import { getModels } from "@/lib/models/getModels";
import { getCurrentModels } from "@/lib/models/getCurrentModels";
import { setModels as setModelsRequest } from "@/lib/models/setModels";
import {
  getEmbeddingModelStatus,
  type EmbeddingModelStatus,
} from "@/lib/models/getEmbeddingModelStatus";
import type { CurrentModels, ModelInfo } from "@/types/model";

interface ModelsContextValue {
  models: ModelInfo[];
  current: CurrentModels;
  hasModel: boolean;
  hasAvailableModels: boolean;
  embeddingModelStatus: EmbeddingModelStatus | null;
  isManageOpen: boolean;
  openManage: () => void;
  closeManage: () => void;
  refreshModels: () => void;
  changeModel: (name: string) => Promise<void>;
  modeResetSignal: number;
  runBusy: <T>(message: string, task: () => Promise<T>) => Promise<T>;
}

const ModelsContext = createContext<ModelsContextValue | null>(null);

export function ModelsProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [current, setCurrent] = useState<CurrentModels>({
    model: "",
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
    getCurrentModels().then(({ data }) => {
      if (data) setCurrent(data);
    });
    getEmbeddingModelStatus().then(({ data }) => {
      if (data) setEmbeddingModelStatus(data);
    });
  }

  useEffect(refreshModels, []);

  async function changeModel(name: string) {
    const previousModel = current.model;
    setCurrent((prev) => ({ ...prev, model: name }));

    await runBusy("Applying model change...", async () => {
      try {
        const { data } = await setModelsRequest({ model: name });
        if (data) setCurrent((prev) => ({ ...prev, model: data.model }));
        setModeResetSignal((n) => n + 1);
      } catch {
        setCurrent((prev) => ({ ...prev, model: previousModel }));
      }
    });
  }

  const value: ModelsContextValue = {
    models,
    current,
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
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/40 backdrop-blur-xs">
          <Loader2 className="size-8 animate-spin text-white" />
          <p className="max-w-xs text-center text-sm text-white">
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
