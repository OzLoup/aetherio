import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getRatings, rateTitle, unrateTitle, type RatingEntry, type RatingValue } from "@/api/ratings";

/** No me gusta / Me gusta / Me encanta of the current profile (synced). */
function useRatingsState() {
  const [ratings, setRatings] = useState<RatingEntry[] | null>(null);

  useEffect(() => {
    getRatings()
      .then(setRatings)
      .catch(() => setRatings([]));
  }, []);

  const ratingOf = (metaId: string) => ratings?.find((r) => r.meta_id === metaId)?.rating ?? null;

  /** Same value again = take the rating back. */
  async function rate(entry: Omit<RatingEntry, "updated_at" | "rating">, value: RatingValue) {
    const before = ratings;
    if (ratingOf(entry.meta_id) === value) {
      setRatings((prev) => (prev ?? []).filter((r) => r.meta_id !== entry.meta_id));
      try {
        await unrateTitle(entry.meta_id);
      } catch (err) {
        setRatings(before);
        throw err;
      }
      return;
    }
    const next: RatingEntry = { ...entry, rating: value, updated_at: new Date().toISOString() };
    setRatings((prev) => [next, ...(prev ?? []).filter((r) => r.meta_id !== entry.meta_id)]);
    try {
      await rateTitle({ ...entry, rating: value });
    } catch (err) {
      setRatings(before);
      throw err;
    }
  }

  return { ratings, ratingOf, rate };
}

type RatingsValue = ReturnType<typeof useRatingsState>;
const RatingsContext = createContext<RatingsValue | undefined>(undefined);

export function RatingsProvider({ children }: { children: ReactNode }) {
  return <RatingsContext.Provider value={useRatingsState()}>{children}</RatingsContext.Provider>;
}

export function useRatings(): RatingsValue {
  const ctx = useContext(RatingsContext);
  if (!ctx) throw new Error("useRatings debe usarse dentro de un RatingsProvider");
  return ctx;
}
