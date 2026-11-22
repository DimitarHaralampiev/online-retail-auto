// Pure helpers for the vehicle selector (shared by client and server).

type GenerationYears = { yearFrom?: number; yearTo?: number | null };

/** Model years covered by the generations, newest first. */
export function modelYears(
  generations: readonly GenerationYears[],
  now: number,
): number[] {
  const years = new Set<number>();
  for (const g of generations)
    if (g.yearFrom)
      for (let y = g.yearFrom; y <= Math.min(g.yearTo ?? now, now); y++)
        years.add(y);
  return [...years].sort((a, b) => b - a);
}

/** Generations produced in `year` (two in a changeover year). */
export function generationsInYear<T extends GenerationYears>(
  generations: readonly T[],
  year: number,
  now: number,
): T[] {
  return generations.filter(
    (g) =>
      g.yearFrom !== undefined &&
      g.yearFrom <= year &&
      (g.yearTo ?? now) >= year,
  );
}
