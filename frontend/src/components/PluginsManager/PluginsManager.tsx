import { useEffect, useState } from "react";
import { getPlugins, setPluginActive } from "@/lib/get-plugins";
import type { Plugin } from "@/types/plugin";
import { PluginsMenu } from "./PluginsMenu";
import { PluginsModal } from "./PluginsModal";

interface PluginsManagerProps {
  forceOpenDownward?: boolean;
}

export function PluginsManager({ forceOpenDownward }: PluginsManagerProps) {
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

  async function toggleAllPlugins(nextActive: boolean) {
    const pluginsToChange = plugins.filter((p) => p.active !== nextActive);
    if (pluginsToChange.length === 0) return;

    setPlugins((prev) => prev.map((p) => ({ ...p, active: nextActive })));

    try {
      await Promise.all(
        pluginsToChange.map((p) => setPluginActive(p.name, nextActive)),
      );
    } catch {
      getPlugins().then(setPlugins);
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
      />
    </>
  );
}
