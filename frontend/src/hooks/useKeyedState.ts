import { useState } from "react";

export type KeyedUpdater<T> = T | ((prev: T) => T);

export interface KeyedState<T> {
  value: T;
  set: (val: KeyedUpdater<T>, targetKey?: string) => void;
  moveKey: (fromKey: string, toKey: string) => void;
  has: (targetKey: string) => boolean;
}

export function useKeyedState<T>(key: string, initial: T): KeyedState<T> {
  const [map, setMap] = useState<Record<string, T>>({});

  const value = key in map ? map[key] : initial;

  const set = (val: KeyedUpdater<T>, targetKey = key) => {
    setMap((prev) => ({
      ...prev,
      [targetKey]:
        typeof val === "function"
          ? (val as (prev: T) => T)(targetKey in prev ? prev[targetKey] : initial)
          : val,
    }));
  };

  const moveKey = (fromKey: string, toKey: string) => {
    setMap((prev) => {
      if (!(fromKey in prev)) return prev;
      const { [fromKey]: moved, ...rest } = prev;
      return { ...rest, [toKey]: moved };
    });
  };

  const has = (targetKey: string) => targetKey in map;

  return { value, set, moveKey, has };
}
