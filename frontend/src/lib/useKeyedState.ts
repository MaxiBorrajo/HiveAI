import { useState } from "react";

export type KeyedUpdater<T> = T | ((prev: T) => T);

export interface KeyedState<T> {
  /** Current value for the active key (the `key` argument's value). */
  value: T;
  /** Sets the value for `targetKey` (defaults to the active key). */
  set: (val: KeyedUpdater<T>, targetKey?: string) => void;
  /** Moves whatever value is stored under `fromKey` to `toKey`, removing `fromKey`. */
  moveKey: (fromKey: string, toKey: string) => void;
  /** Whether `targetKey` has ever been explicitly set (vs. still falling back to `initial`). */
  has: (targetKey: string) => boolean;
}

/**
 * Backs one `Record<string, T>` map keyed by an external id (e.g. the
 * active execution's id), with a getter/setter pair that defaults to the
 * currently active `key`. ExecutionsMain previously hand-rolled this same
 * pattern independently for 10 separate pieces of per-execution UI state
 * (isThinking, isRunning, graph, activeNodeId, ...); this collapses each of
 * those into one `useKeyedState` call.
 */
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
