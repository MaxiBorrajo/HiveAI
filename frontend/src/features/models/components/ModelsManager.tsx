import { useModels } from "@/features/models/ModelsContext";
import { ModelMenu } from "./ModelMenu";
import { ModelsModal } from "./ModelsModal";

interface ModelsManagerProps {
  forceOpenDownward?: boolean;
}

export function ModelsManager({ forceOpenDownward }: ModelsManagerProps) {
  const {
    models,
    current,
    changeModel,
    isManageOpen,
    openManage,
    closeManage,
    refreshModels,
  } = useModels();

  return (
    <>
      <ModelMenu
        models={models}
        current={current}
        onChangeModel={changeModel}
        onOpenManage={openManage}
        onOpen={refreshModels}
        forceOpenDownward={forceOpenDownward}
      />
      <ModelsModal
        isOpen={isManageOpen}
        onOpenChange={(open) => (open ? openManage() : closeManage())}
        models={models}
        current={current}
        onChangeModel={changeModel}
      />
    </>
  );
}
