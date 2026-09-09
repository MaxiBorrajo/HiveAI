import { useEffect, useState, type SetStateAction } from "react";
import { getModels } from "@/lib/models/getModels";
import { getCurrentModels } from "@/lib/models/getCurrentModels";
import { setModels } from "@/lib/models/setModels";
import type { CurrentModels, ModelInfo } from "@/types/model";
import { ModelMenu } from "./ModelMenu";
import { ModelsModal } from "./ModelsModal";

interface ModelManagerProps {
  forceOpenDownward?: boolean;
  onCurrentModelsChange?: (current: CurrentModels) => void;
}

export function ModelManager({
  forceOpenDownward,
  onCurrentModelsChange,
}: ModelManagerProps) {
  const [models, setModelsList] = useState<ModelInfo[]>([]);
  const [current, setCurrentState] = useState<CurrentModels>({
    model: "",
    selectorModel: "",
  });

  function setCurrent(update: SetStateAction<CurrentModels>) {
    setCurrentState((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      onCurrentModelsChange?.(next);
      return next;
    });
  }

  const [isModalOpen, setIsModalOpen] = useState(false);

  function refreshModels() {
    getModels().then(({ data }) => setModelsList(data ?? []));
    getCurrentModels().then(({ data }) => {
      if (data) setCurrent(data);
    });
  }

  useEffect(refreshModels, []);

  async function changeModel(name: string) {
    const previousModel = current.model;
    setCurrent((prev) => ({ ...prev, model: name }));

    try {
      const { data } = await setModels({ model: name });
      if (data) setCurrent((prev) => ({ ...prev, model: data.model }));
    } catch {
      setCurrent((prev) => ({ ...prev, model: previousModel }));
    }
  }

  async function changeSelectorModel(name: string) {
    const previousSelectorModel = current.selectorModel;
    setCurrent((prev) => ({ ...prev, selectorModel: name }));

    try {
      const { data } = await setModels({ selectorModel: name });
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

  return (
    <>
      <ModelMenu
        models={models}
        current={current}
        onChangeModel={changeModel}
        onChangeSelectorModel={changeSelectorModel}
        onOpenManage={() => setIsModalOpen(true)}
        onOpen={refreshModels}
        forceOpenDownward={forceOpenDownward}
      />
      <ModelsModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        models={models}
        current={current}
        onChangeModel={changeModel}
        onChangeSelectorModel={changeSelectorModel}
      />
    </>
  );
}
