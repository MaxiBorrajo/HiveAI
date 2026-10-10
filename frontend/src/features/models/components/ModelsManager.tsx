import { useModels } from "@/features/models/ModelsContext";
import { ApiKeysModal } from "@/features/api-keys/components/ApiKeysModal";
import { ModelMenu } from "./ModelMenu";
import { ModelsModal } from "./ModelsModal";

export function ModelsManager() {
  const {
    models,
    optionGroups,
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
        groups={optionGroups}
        current={current}
        onChangeModel={changeModel}
        onOpenManage={openManage}
        onOpenKeys={openKeys}
        onOpen={refreshModels}
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
