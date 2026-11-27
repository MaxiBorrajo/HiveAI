/**
 * Cases per category in a quick profile: enough to tell a model that works
 * from one that doesn't, too few to compare two models (its metrics are
 * marked low confidence).
 */
export const QUICK_CASES_PER_CATEGORY = 5;

/**
 * Every case, or in quick mode a few per category spread across the list,
 * so they cover the whole case set rather than its oldest cases. The order
 * of the cases is kept, and the same cases are picked every time.
 */
export function selectCases<T>(
  cases: T[],
  categoryOf: (testCase: T) => string,
  quick: boolean,
): T[] {
  if (!quick) return cases;
  const byCategory = new Map<string, T[]>();
  for (const testCase of cases) {
    const list = byCategory.get(categoryOf(testCase)) ?? [];
    list.push(testCase);
    byCategory.set(categoryOf(testCase), list);
  }
  const picked = new Set<T>();
  for (const list of byCategory.values()) {
    const count = Math.min(QUICK_CASES_PER_CATEGORY, list.length);
    for (let i = 0; i < count; i++) {
      picked.add(list[count === 1 ? 0 : Math.round((i * (list.length - 1)) / (count - 1))]);
    }
  }
  return cases.filter((testCase) => picked.has(testCase));
}
