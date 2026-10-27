const active = new Map<string, number>();

/** Marks a local model as in use; call the returned function when done. */
export function beginModelActivity(model: string): () => void {
  active.set(model, (active.get(model) ?? 0) + 1);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const left = (active.get(model) ?? 1) - 1;
    if (left <= 0) active.delete(model);
    else active.set(model, left);
  };
}

export function isModelInUse(model: string): boolean {
  return (active.get(model) ?? 0) > 0;
}
