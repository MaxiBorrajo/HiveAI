import { useEffect, useState } from "react";
import { getPlugins } from "@/features/plugins/api/getPlugins";
import type { Plugin } from "@/features/plugins/types";

export function useActivePlugins(enabled: boolean): Plugin[] {
  const [plugins, setPlugins] = useState<Plugin[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getPlugins()
      .then(({ data }) => {
        if (!cancelled) setPlugins((data ?? []).filter((p) => p.active));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return plugins;
}
