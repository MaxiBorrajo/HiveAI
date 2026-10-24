import { useEffect, useState } from "react";
import type { ResponseEntity } from "../lib/config";

export interface EntityListItem {
  id: string;
  updatedAt: number;
}

export interface EntityListCrud<T extends EntityListItem, TUpdateDto> {
  list: () => Promise<ResponseEntity<T[]>>;
  remove: (id: string) => Promise<unknown>;
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
