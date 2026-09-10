import { useEffect, useState } from "react";
import { getPlugins } from "@/lib/plugins/getPlugins";
import { setPluginActive } from "@/lib/plugins/setPluginActive";
import { importPlugin } from "@/lib/plugins/importPlugin";
import { removePlugin } from "@/lib/plugins/removePlugin";
import { editPlugin } from "@/lib/plugins/editPlugin";
import { toastManager } from "@/lib/toastManager";
import type { Plugin } from "@/types/plugin";
import { useModels } from "@/context/ModelsContext";
import { PluginsMenu } from "./PluginsMenu";
import { PluginsModal } from "./PluginsModal";
import { useDraftEditor } from "./draft-editor-context";

interface PluginsManagerProps {
  forceOpenDownward?: boolean;
}

export function PluginsManager({ forceOpenDownward }: PluginsManagerProps) {
  const { hasModel } = useModels();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const { openDraft, pluginsVersion } = useDraftEditor();

  function refreshPlugins() {
    return getPlugins().then(({ data }) => setPlugins(data ?? []));
  }

  useEffect(() => {
    refreshPlugins();
  }, [pluginsVersion]);

  async function togglePlugin(plugin: Plugin, nextActive: boolean) {
    setPlugins((prev) =>
      prev.map((p) => (p.id === plugin.id ? { ...p, active: nextActive } : p)),
    );

    try {
      await setPluginActive(plugin.name, nextActive);
    } catch {
      setPlugins((prev) =>
        prev.map((p) =>
          p.id === plugin.id ? { ...p, active: plugin.active } : p,
        ),
      );
    }
  }

  async function handleImportPlugin(files: FileList) {
    setIsImporting(true);
    try {
      const { data, success, errors } = await importPlugin(files);
      console.log("[PluginsManager] importPlugin response:", { success, data, errors });
      if (success && data) {
        await refreshPlugins();
        toastManager.add({ type: "success", title: `'${data.name}' imported successfully.` });
      }
      // On failure the apiClient interceptor already shows an error toast.
    } catch (error) {
      console.error("[PluginsManager] importPlugin threw:", error);
    } finally {
      setIsImporting(false);
    }
  }

  async function handleRemovePlugin(plugin: Plugin) {
    const { success } = await removePlugin(plugin.name);
    if (success) {
      await refreshPlugins();
      toastManager.add({ type: "success", title: `'${plugin.name}' removed.` });
    }
  }

  async function handleEditPlugin(plugin: Plugin) {
    const { success } = await editPlugin(plugin.name);
    if (success) {
      await refreshPlugins();
      setIsModalOpen(false);
      openDraft(plugin.name);
      toastManager.add({ type: "success", title: `'${plugin.name}' moved to drafts for editing.` });
    }
  }

  async function toggleAllPlugins(nextActive: boolean) {
    const pluginsToChange = plugins.filter((p) => p.active !== nextActive);
    if (pluginsToChange.length === 0) return;

    setPlugins((prev) => prev.map((p) => ({ ...p, active: nextActive })));

    try {
      await Promise.all(
        pluginsToChange.map((p) => setPluginActive(p.name, nextActive)),
      );
    } catch {
      getPlugins().then(({ data }) => setPlugins(data ?? []));
    }
  }

  return (
    <>
      <PluginsMenu
        plugins={plugins}
        onToggle={togglePlugin}
        onToggleAll={toggleAllPlugins}
        onOpenManage={() => setIsModalOpen(true)}
        forceOpenDownward={forceOpenDownward}
      />
      <PluginsModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        plugins={plugins}
        onToggle={togglePlugin}
        onToggleAll={toggleAllPlugins}
        hasModel={hasModel}
        onImportPlugin={handleImportPlugin}
        onRemovePlugin={handleRemovePlugin}
        onEditPlugin={handleEditPlugin}
        isImporting={isImporting}
        onOpenDraft={(name) => {
          setIsModalOpen(false);
          openDraft(name);
        }}
      />
    </>
  );
}
