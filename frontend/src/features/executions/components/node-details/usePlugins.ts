import { useEffect, useState } from "react";
import { getPlugins } from "@/features/plugins/api/getPlugins";
import type { Plugin } from "@/features/plugins/types";

/**
 * Every installed plugin, active or not. "Active" means switched on for the
 * chat; an execution is a separate thing and may use any of them (imported
 * plugins additionally need to be running, which the run checks for).
 */
export function useInstalledPlugins(enabled: boolean): Plugin[] {
  const [plugins, setPlugins] = useState<Plugin[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getPlugins()
      .then(({ data }) => {
        if (!cancelled) setPlugins(data ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return plugins;
}
