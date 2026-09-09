import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getModels } from "@/lib/models/getModels";
import { getCurrentModels } from "@/lib/models/getCurrentModels";
import { setModels as setModelsRequest } from "@/lib/models/setModels";
import type { CurrentModels, ModelInfo } from "@/types/model";

interface ModelsContextValue {
  models: ModelInfo[];
  current: CurrentModels;
  hasModel: boolean;
  hasAvailableModels: boolean;
  isManageOpen: boolean;
  openManage: () => void;
  closeManage: () => void;
  refreshModels: () => void;
  changeModel: (name: string) => Promise<void>;
  changeSelectorModel: (name: string) => Promise<void>;
}

const ModelsContext = createContext<ModelsContextValue | null>(null);

export function ModelsProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [current, setCurrent] = useState<CurrentModels>({
    model: "",
    selectorModel: "",
  });
  const [isManageOpen, setIsManageOpen] = useState(false);

  function refreshModels() {
    getModels().then(({ data }) => setModels(data ?? []));
    getCurrentModels().then(({ data }) => {
      if (data) setCurrent(data);
    });
  }

  useEffect(refreshModels, []);

  async function changeModel(name: string) {
    const previousModel = current.model;
    setCurrent((prev) => ({ ...prev, model: name }));

    try {
      const { data } = await setModelsRequest({ model: name });
      if (data) setCurrent((prev) => ({ ...prev, model: data.model }));
    } catch {
      setCurrent((prev) => ({ ...prev, model: previousModel }));
    }
  }

  async function changeSelectorModel(name: string) {
    const previousSelectorModel = current.selectorModel;
    setCurrent((prev) => ({ ...prev, selectorModel: name }));

    try {
      const { data } = await setModelsRequest({ selectorModel: name });
      if (data)
        setCurrent((prev) => ({
          ...prev,
          selectorModel: data.selectorModel,
        }));
    } catch {
      setCurrent((prev) => ({
        ...prev,
        selectorModel: previousSelectorModel,
      }));
    }
  }

  const value: ModelsContextValue = {
    models,
    current,
    hasModel: !!current.model && !!current.selectorModel,
    hasAvailableModels: models.length > 0,
    isManageOpen,
    openManage: () => setIsManageOpen(true),
    closeManage: () => setIsManageOpen(false),
    refreshModels,
    changeModel,
    changeSelectorModel,
  };

  return (
    <ModelsContext.Provider value={value}>{children}</ModelsContext.Provider>
  );
}

export function useModels(): ModelsContextValue {
  const context = useContext(ModelsContext);
  if (!context) {
    throw new Error("useModels must be used within a ModelsProvider");
  }
  return context;
}
