import { useEffect, useState } from "react";
import { getPlugins, setPluginActive } from "@/lib/get-plugins";
import type { Plugin } from "@/types/plugin";
import { PluginsMenu } from "./PluginsMenu";
import { PluginsModal } from "./PluginsModal";

export function PluginsManager() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    getPlugins().then(setPlugins);
  }, []);

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

  return (
    <>
      <PluginsMenu
        plugins={plugins}
        onToggle={togglePlugin}
        onOpenManage={() => setIsModalOpen(true)}
      />
      <PluginsModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        plugins={plugins}
        onToggle={togglePlugin}
      />
    </>
  );
}
