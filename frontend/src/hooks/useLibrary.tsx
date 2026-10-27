import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { addToLibrary, getLibrary, removeFromLibrary, type LibraryItem } from "@/api/library";

/** "Mi lista" of the current profile (synced: it lives in the backend).
 * Mounted per profile next to AddonsProvider. */
function useLibraryState() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);

  useEffect(() => {
    getLibrary()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  const has = useCallback((metaId: string) => Boolean(items?.some((i) => i.meta_id === metaId)), [items]);

  async function add(item: Omit<LibraryItem, "added_at">) {
    const optimistic: LibraryItem = { ...item, added_at: new Date().toISOString() };
    setItems((prev) => [optimistic, ...(prev ?? []).filter((i) => i.meta_id !== item.meta_id)]);
    try {
      const saved = await addToLibrary(item);
      setItems((prev) => (prev ?? []).map((i) => (i.meta_id === saved.meta_id ? saved : i)));
    } catch (err) {
      setItems((prev) => (prev ?? []).filter((i) => i.meta_id !== item.meta_id));
      throw err;
    }
  }

  async function remove(metaId: string) {
    const before = items;
    setItems((prev) => (prev ?? []).filter((i) => i.meta_id !== metaId));
    try {
      await removeFromLibrary(metaId);
    } catch (err) {
      setItems(before);
      throw err;
    }
  }

  return { items, has, add, remove };
}

type LibraryValue = ReturnType<typeof useLibraryState>;
const LibraryContext = createContext<LibraryValue | undefined>(undefined);

export function LibraryProvider({ children }: { children: ReactNode }) {
  return <LibraryContext.Provider value={useLibraryState()}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary debe usarse dentro de un LibraryProvider");
  return ctx;
}
