import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ModelChoice } from "@/features/models/lib/modelChoices";
import { useModelSearch } from "../lib/useModelSearch";
import { type ModelSource, NO_FILTERS, type SearchFilters, type SearchSort, type SuggestResult } from "../types";
import { FilterChip } from "./FilterChip";
import { type AdvisorChoice, ModelAdvisorBar } from "./ModelAdvisorBar";
import { ModelResultItem } from "./ModelResultItem";

interface ModelSearchProps {
  onSelect: (id: string, source: ModelSource) => void;
  /** Models the user can ask for suggestions. Without them the advisor is not shown. */
  advisorChoices?: AdvisorChoice[];
  advisorDefault?: ModelChoice | null;
}

const SOURCE_CHIPS: { source: ModelSource; label: string }[] = [
  { source: "ollama", label: "Ollama library" },
  { source: "huggingface", label: "Hugging Face" },
];

/** ollama.com only orders by popularity and by date */
const LIBRARY_SORTS: SearchSort[] = ["recommended", "downloads", "updated"];

const SORT_CHIPS: { sort: SearchSort; label: string }[] = [
  { sort: "recommended", label: "Recommended" },
  { sort: "trending", label: "Trending" },
  { sort: "downloads", label: "Most downloaded" },
  { sort: "likes", label: "Most liked" },
  { sort: "updated", label: "Newest" },
];

const FILTER_CHIPS: { key: keyof SearchFilters; label: string }[] = [
  { key: "tools", label: "Tools" },
  { key: "vision", label: "Vision" },
  { key: "reasoning", label: "Reasoning" },
  { key: "fitsOnly", label: "Fits my hardware" },
];

export function ModelSearch({ onSelect, advisorChoices = [], advisorDefault = null }: ModelSearchProps) {
  // while set, the list below shows what the asked model suggested instead of the library
  const [advice, setAdvice] = useState<{ query: string; result: SuggestResult } | null>(null);
  const [source, setSource] = useState<ModelSource>("ollama");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SearchSort>("recommended");
  const [filters, setFilters] = useState<SearchFilters>(NO_FILTERS);
  const sortChips = source === "ollama"
    ? SORT_CHIPS.filter((c) => LIBRARY_SORTS.includes(c.sort))
    : SORT_CHIPS;
  const sortAllowed = sortChips.some((c) => c.sort === sort) ? sort : "recommended";
  // "Recommended" is the curated list: it only applies while the search box is empty
  const effectiveSort = query.trim() && sortAllowed === "recommended" ? "downloads" : sortAllowed;
  const { items, loading, loadingMore, hasMore, error, offline, loadMore } = useModelSearch(
    source,
    query,
    effectiveSort,
    filters,
  );
  const anyFilter = Object.values(filters).some(Boolean);

  const sentinel = useRef<HTMLDivElement>(null);
  const [observable] = useState(() => typeof IntersectionObserver !== "undefined");
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !observable || !hasMore) return;
    // the modal scrolls inside a ScrollArea viewport: observing relative to it makes rootMargin apply
    const root = node.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const observer = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && loadMore(),
      { root, rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  // loadingMore: a fresh observer reports a sentinel that is still in view, so sparse pages keep loading
  }, [observable, hasMore, loadMore, items.length, loadingMore]);

  return (
    <div className="flex flex-col gap-2">
      <div className="sticky top-0 z-10 flex flex-col gap-2 bg-popover py-1">
        <ModelAdvisorBar
          choices={advisorChoices}
          defaultChoice={advisorDefault}
          onResult={(query, result) => setAdvice({ query, result })}
        />
        {!advice && (
          <>
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                className="pl-8"
                placeholder="Search models, for example qwen3 or llama"
                aria-label="Search models"
                data-testid="model-search-input"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Source">
              {SOURCE_CHIPS.map(({ source: value, label }) => (
                <FilterChip
                  key={value}
                  active={source === value}
                  onClick={() => setSource(value)}
                  testId={`model-source-${value}`}
                >
                  {label}
                </FilterChip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sort">
              {sortChips.map(({ sort: value, label }) => (
                <FilterChip
                  key={value}
                  active={effectiveSort === value}
                  onClick={() => setSort(value)}
                  testId={`model-sort-${value}`}
                >
                  {label}
                </FilterChip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filters">
              {FILTER_CHIPS.map(({ key, label }) => (
                <FilterChip
                  key={key}
                  active={filters[key]}
                  onClick={() => setFilters((f) => ({ ...f, [key]: !f[key] }))}
                  testId={`model-filter-${key}`}
                >
                  {label}
                </FilterChip>
              ))}
            </div>
          </>
        )}
      </div>

      {advice ? (
        <div className="flex flex-col gap-2" data-testid="model-advice">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              Suggested for: <span className="font-normal text-muted-foreground">{advice.query}</span>
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAdvice(null)}
              data-testid="model-advice-clear"
              aria-label="Back to all models"
            >
              <X size={14} /> All models
            </Button>
          </div>
          {advice.result.items.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="model-advice-empty">
              {advice.result.message ?? "No suggestions."}
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {advice.result.items.map((item) => (
              <ModelResultItem
                key={item.card.id}
                item={item}
                onSelect={onSelect}
                reason={advice.result.reasons[item.card.id]}
              />
            ))}
          </ul>
        </div>
      ) : (
        <>
        {source === "huggingface" && (
          <p className="text-xs text-muted-foreground" role="note" data-testid="model-search-hf-note">
            These models are not verified with Ollama: they may fail to load or lack tool support.
            Models from the Ollama library are guaranteed to run.
          </p>
        )}
        {offline && (
          <p className="text-xs text-muted-foreground" data-testid="model-search-offline">
            {source === "ollama" ? "ollama.com" : "Hugging Face"} is not reachable, so only a few
            recommended models are shown (sizes are estimates).
          </p>
        )}
        {loading && <p className="text-xs text-muted-foreground">Searching…</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground" data-testid="model-search-empty">
              {anyFilter ? "No models match these filters." : "No models found."}
            </p>
            {anyFilter && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters(NO_FILTERS)}
                data-testid="model-search-clear-filters"
              >
                Clear filters
              </Button>
            )}
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <ModelResultItem key={item.card.id} item={item} onSelect={onSelect} />
          ))}
        </ul>

        {hasMore && (
          <div ref={sentinel} className="flex justify-center py-2">
            {loadingMore ? (
              <p className="text-xs text-muted-foreground">Loading more…</p>
            ) : (
              <Button variant="ghost" size="sm" onClick={loadMore} data-testid="model-search-load-more">
                Load more
              </Button>
            )}
          </div>
        )}
        {!loading && !hasMore && !offline && items.length > 0 && effectiveSort !== "recommended" && (
          <p className="py-2 text-center text-xs text-muted-foreground" data-testid="model-search-end">
            End of results
          </p>
        )}
        </>
      )}
    </div>
  );
}
