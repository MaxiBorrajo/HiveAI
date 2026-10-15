export interface ActivityEntry {
  id: string;
  kind:
    | "planning"
    | "built"
    | "configuring"
    | "configured"
    | "removed"
    | "waiting"
    | "answered"
    | "correction"
    | "done"
    | "error";
  text: string;
  nodeId?: string;
  startedAt: number;
  durationMs?: number;
}

export function newActivityEntry(
  entry: Omit<ActivityEntry, "id" | "startedAt">,
): ActivityEntry {
  return { ...entry, id: crypto.randomUUID(), startedAt: Date.now() };
}

export function finishConfiguring(
  entries: ActivityEntry[],
  nodeId: string,
  nodeName: string,
): ActivityEntry[] {
  const index = entries.findLastIndex(
    (e) => e.kind === "configuring" && e.nodeId === nodeId,
  );
  if (index === -1) {
    return [
      ...entries,
      newActivityEntry({
        kind: "configured",
        text: `Configured ${nodeName}`,
        nodeId,
      }),
    ];
  }
  return entries.map((entry, i) =>
    i === index
      ? {
          ...entry,
          kind: "configured" as const,
          text: `Configured ${nodeName}`,
          durationMs: Date.now() - entry.startedAt,
        }
      : entry,
  );
}
