import { useEffect, useState } from "react";
import { getPlugins } from "@/features/plugins/api/getPlugins";
import { setPluginActive } from "@/features/plugins/api/setPluginActive";
import { setPluginsActiveBatch } from "@/features/plugins/api/setPluginsActiveBatch";
import { importPlugin } from "@/features/plugins/api/importPlugin";
import { removePlugin } from "@/features/plugins/api/removePlugin";
import { toastManager } from "@/lib/toastManager";
import type { Plugin } from "@/features/plugins/types";
import { useModels } from "@/features/models/ModelsContext";
import { PluginsMenu } from "./PluginsMenu";
import { PluginsModal } from "./PluginsModal";
import { PluginConfigDialog } from "./PluginConfigDialog";
import { useDraftEditor } from "../../drafts/DraftEditorContext";

export function PluginsManager() {
  const { hasModel } = useModels();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [configuringPlugin, setConfiguringPlugin] = useState<string | null>(
    null,
  );
  const { openDraft, openEditor, pluginsVersion } = useDraftEditor();

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

  async function handleImportPlugin(file: File) {
    setIsImporting(true);
    try {
      const { data, success } = await importPlugin(file);
      if (success && data) {
        await refreshPlugins();
        toastManager.add({
          type: "success",
          title: `'${data.name}' imported successfully.`,
        });
      }
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

  /** Opens the plugin in the editor (view mode); editing it moves it to drafts from there. */
  function handleEditPlugin(plugin: Plugin) {
    setIsModalOpen(false);
    openEditor({ name: plugin.name, kind: "official" });
  }

  async function toggleAllPlugins(nextActive: boolean) {
    const pluginsToChange = plugins.filter((p) => p.active !== nextActive);
    if (pluginsToChange.length === 0) return;

    setPlugins((prev) => prev.map((p) => ({ ...p, active: nextActive })));

    const { success, data } = await setPluginsActiveBatch(
      pluginsToChange.map((p) => ({ name: p.name, active: nextActive })),
    );

    if (!success || data) {
      setPlugins(data ?? []);
    }
  }

  return (
    <>
      <PluginsMenu
        plugins={plugins}
        onToggle={togglePlugin}
        onToggleAll={toggleAllPlugins}
        onOpenManage={() => setIsModalOpen(true)}
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
        onConfigurePlugin={(plugin) => setConfiguringPlugin(plugin.name)}
        isImporting={isImporting}
        onOpenDraft={(name) => {
          setIsModalOpen(false);
          openDraft(name);
        }}
      />
      <PluginConfigDialog
        pluginName={configuringPlugin}
        onOpenChange={(open) => !open && setConfiguringPlugin(null)}
      />
    </>
  );
}
