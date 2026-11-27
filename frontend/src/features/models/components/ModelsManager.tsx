import { useModels } from "@/features/models/ModelsContext";
import { ApiKeysModal } from "@/features/api-keys/components/ApiKeysModal";
import { useDownloads } from "@/features/models/DownloadsContext";
import { ExploreModelsModal } from "./ExploreModelsModal";
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
    isExploreOpen,
    openExplore,
    closeExplore,
    isKeysOpen,
    openKeys,
    closeKeys,
    refreshModels,
    deleteLocalModel,
    embeddingModelStatus,
  } = useModels();
  const { downloads } = useDownloads();
  const activeDownloads = downloads.filter(
    (d) => d.status === "queued" || d.status === "downloading",
  ).length;

  return (
    <>
      <ModelMenu
        groups={optionGroups}
        current={current}
        onChangeModel={changeModel}
        onOpenManage={openManage}
        onOpenExplore={openExplore}
        activeDownloads={activeDownloads}
        onOpenKeys={openKeys}
        onOpen={refreshModels}
      />
      <ModelsModal
        isOpen={isManageOpen}
        onOpenChange={(open) => (open ? openManage() : closeManage())}
        models={models}
        groups={optionGroups}
        current={current}
        onChangeModel={changeModel}
        onDeleteModel={deleteLocalModel}
        protectedModel={embeddingModelStatus?.model}
      />
      <ExploreModelsModal
        isOpen={isExploreOpen}
        onOpenChange={(open) => (open ? openExplore() : closeExplore())}
      />
      <ApiKeysModal
        isOpen={isKeysOpen}
        onOpenChange={(open) => (open ? openKeys() : closeKeys())}
        onChanged={refreshModels}
      />
    </>
  );
}
