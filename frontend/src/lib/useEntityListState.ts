import { useEffect, useState } from "react";
import type { ResponseEntity } from "./config";

export interface EntityListItem {
  id: string;
  updatedAt: number;
}

export interface EntityListCrud<T extends EntityListItem, TUpdateDto> {
  list: () => Promise<ResponseEntity<T[]>>;
  remove: (id: string) => Promise<unknown>;
  // The server's update response doesn't need to be exactly T — e.g.
  // ExecutionsContext's backend returns the full `Execution` entity (with a
  // numeric `id`) while the list is typed as `ExecutionSummary` (string
  // `id`). `mergeUpdate` only ever reads the fields it needs off it, so a
  // structurally-compatible partial response is enough.
  update: (id: string, dto: TUpdateDto) => Promise<{ data?: Partial<T> }>;
}

export interface EntityListState<T extends EntityListItem, TUpdateDto> {
  items: T[];
  activeId: string | null;
  newItemToken: string;
  isLoading: boolean;
  refresh: () => void;
  select: (id: string) => void;
  startNew: () => void;
  remove: (id: string) => Promise<void>;
  update: (id: string, dto: TUpdateDto) => Promise<void>;
  onCreated: (id: string) => void;
  touch: (id: string) => void;
}

/**
 * Factory hook behind ChatsContext/ExecutionsContext: both providers manage
 * the exact same shape (list + active/new-item selection + CRUD against the
 * backend), differing only in the concrete item type, the update DTO, and
 * how a fetched/updated item merges an optimistic patch onto the item.
 * `mergeUpdate` lets each caller decide how the server's partial update
 * response (or a lack thereof) is applied to the locally cached item,
 * mirroring the "apply patch, or refetch if the server returned nothing"
 * behavior both contexts had inline.
 */
export function useEntityListState<T extends EntityListItem, TUpdateDto>(
  crud: EntityListCrud<T, TUpdateDto>,
  mergeUpdate: (item: T, dto: TUpdateDto, serverItem: Partial<T> | undefined) => T,
): EntityListState<T, TUpdateDto> {
  const [items, setItems] = useState<T[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newItemToken, setNewItemToken] = useState(() => crypto.randomUUID());
  const [isLoading, setIsLoading] = useState(false);

  function refresh() {
    setIsLoading(true);
    crud
      .list()
      .then(({ data }) => setItems(data ?? []))
      .finally(() => setIsLoading(false));
  }

  useEffect(refresh, []);

  function select(id: string) {
    setActiveId(id);
  }

  function startNew() {
    setActiveId(null);
    setNewItemToken(crypto.randomUUID());
  }

  function onCreated(id: string) {
    setActiveId(id);
    refresh();
  }

  function touch(id: string) {
    setItems((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index === -1) return prev;

      const touched = { ...prev[index], updatedAt: Date.now() };
      const rest = prev.filter((item) => item.id !== id);
      return [touched, ...rest];
    });
  }

  async function remove(id: string) {
    await crud.remove(id);
    if (activeId === id) {
      setActiveId(null);
      setNewItemToken(crypto.randomUUID());
    }
    refresh();
  }

  async function update(id: string, dto: TUpdateDto) {
    const { data } = await crud.update(id, dto);
    if (data) {
      setItems((prev) =>
        prev.map((item) => (item.id === id ? mergeUpdate(item, dto, data) : item)),
      );
    } else {
      refresh();
    }
  }

  return {
    items,
    activeId,
    newItemToken,
    isLoading,
    refresh,
    select,
    startNew,
    remove,
    update,
    onCreated,
    touch,
  };
}
