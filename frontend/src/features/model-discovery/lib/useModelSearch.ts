import { useCallback, useEffect, useRef, useState } from "react";
import { searchModels } from "../api/discovery";
import type { SearchFilters, SearchResultItem, SearchSort } from "../types";

const DEBOUNCE_MS = 400;

interface State {
  items: SearchResultItem[];
  nextCursor: string | null;
  offline: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

const INITIAL: State = {
  items: [],
  nextCursor: null,
  offline: false,
  loading: true,
  loadingMore: false,
  error: null,
};

/**
 * Paginated model search. Any change of query, sort or filters starts over from page one;
 * `loadMore` appends the next page, and answers that arrive for an outdated request are dropped.
 */
export function useModelSearch(query: string, sort: SearchSort, filters: SearchFilters) {
  const [state, setState] = useState<State>(INITIAL);
  const request = useRef(0);
  const { tools, vision, reasoning, fitsOnly } = filters;

  useEffect(() => {
    const id = ++request.current;
    const q = query.trim();
    setState((s) => ({ ...s, items: [], nextCursor: null, loading: true, loadingMore: false, error: null }));
    const timer = setTimeout(() => {
      searchModels({ q, sort, filters: { tools, vision, reasoning, fitsOnly } })
        .then((r) => {
          if (id !== request.current) return;
          if (r.data) {
            setState({
              items: r.data.items,
              nextCursor: r.data.nextCursor ?? null,
              offline: r.data.offline,
              loading: false,
              loadingMore: false,
              error: null,
            });
          } else {
            setState((s) => ({ ...s, loading: false, error: r.errors?.[0] ?? "Search failed." }));
          }
        })
        .catch((e: Error) => {
          if (id === request.current) setState((s) => ({ ...s, loading: false, error: e.message }));
        });
    }, q ? DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [query, sort, tools, vision, reasoning, fitsOnly]);

  const { nextCursor, loading, loadingMore } = state;
  const loadMore = useCallback(() => {
    if (!nextCursor || loading || loadingMore) return;
    const id = request.current;
    setState((s) => ({ ...s, loadingMore: true, error: null }));
    searchModels({ q: query.trim(), sort, filters: { tools, vision, reasoning, fitsOnly }, cursor: nextCursor })
      .then((r) => {
        if (id !== request.current) return;
        if (r.data) {
          const page = r.data;
          setState((s) => {
            const known = new Set(s.items.map((i) => i.card.id));
            return {
              ...s,
              items: [...s.items, ...page.items.filter((i) => !known.has(i.card.id))],
              nextCursor: page.nextCursor ?? null,
              loadingMore: false,
            };
          });
        } else {
          setState((s) => ({ ...s, loadingMore: false, error: r.errors?.[0] ?? "Could not load more." }));
        }
      })
      .catch((e: Error) => {
        if (id === request.current) setState((s) => ({ ...s, loadingMore: false, error: e.message }));
      });
  }, [nextCursor, loading, loadingMore, query, sort, tools, vision, reasoning, fitsOnly]);

  return { ...state, hasMore: state.nextCursor !== null, loadMore };
}
