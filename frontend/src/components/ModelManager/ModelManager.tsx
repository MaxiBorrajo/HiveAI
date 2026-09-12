import { useModels } from "@/context/ModelsContext";
import { ModelMenu } from "./ModelMenu";
import { ModelsModal } from "./ModelsModal";

interface ModelManagerProps {
  forceOpenDownward?: boolean;
}

export function ModelManager({ forceOpenDownward }: ModelManagerProps) {
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
