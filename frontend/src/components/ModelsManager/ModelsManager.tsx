import { useEffect, useState } from "react";
import type { Model } from "../../types/ai.ts";
import { getModels } from "../../lib/api/ai/get-models.ts";
import { ModelsMenu } from "./ModelsMenu.tsx";
import { ModelsModal } from "./ModelsModal.tsx";

export function ModelsManager() {
  const [models, setModels] = useState<Model[]>([]);
  const [currentModel, setCurrentModel] = useState<Model>();
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    getModels().then(setModels);
    getCurrentModel().then(setCurrentModel);
  }, []);

  async function changeModel(model: Model) {
    const prevModel = currentModel;
    try {
        setCurrentModel(model);
      await setModel(model.name);
    } catch {
      setCurrentModel(prevModel);
    }
  }

  return (
    <>
      <ModelsMenu
        models={models}
        currentModel={currentModel}
        onToggle={changeModel}
        onOpenManage={() => setIsModalOpen(true)}
      />
      <ModelsModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        models={models}
        currentModel={currentModel}
        onToggle={changeModel}
      />
    </>
  );
}
