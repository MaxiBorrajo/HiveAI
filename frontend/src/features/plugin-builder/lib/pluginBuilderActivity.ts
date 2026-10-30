export interface ActivityEntry {
  id: string;
  kind:
    | "planning"
    | "signature"
    | "process"
    | "tests"
    | "validating"
    | "correction"
    | "done"
    | "error";
  text: string;
  startedAt: number;
}

export function newActivityEntry(
  entry: Omit<ActivityEntry, "id" | "startedAt">,
): ActivityEntry {
  return { ...entry, id: crypto.randomUUID(), startedAt: Date.now() };
}
