import { useModels } from "@/features/models/ModelsContext";
import { ApiKeysModal } from "@/features/api-keys/components/ApiKeysModal";
import { ModelMenu } from "./ModelMenu";
import { ModelsModal } from "./ModelsModal";

interface ModelsManagerProps {
  forceOpenDownward?: boolean;
}

export function ModelsManager({ forceOpenDownward }: ModelsManagerProps) {
  const {
    models,
    cloudGroups,
    current,
    changeModel,
    isManageOpen,
    openManage,
    closeManage,
    isKeysOpen,
    openKeys,
    closeKeys,
    refreshModels,
  } = useModels();

  return (
    <>
      <ModelMenu
        models={models}
        cloudGroups={cloudGroups}
        current={current}
        onChangeModel={changeModel}
        onOpenManage={openManage}
        onOpenKeys={openKeys}
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
      <ApiKeysModal
        isOpen={isKeysOpen}
        onOpenChange={(open) => (open ? openKeys() : closeKeys())}
        onChanged={refreshModels}
      />
    </>
  );
}
