import { api } from "@/api/client";

export interface LibraryItem {
  meta_id: string;
  type: string;
  name: string;
  poster?: string | null;
  poster_shape?: "poster" | "square" | "landscape" | null;
  added_at: string;
}

const enc = encodeURIComponent;

export async function getLibrary() {
  const { data } = await api.get<LibraryItem[]>("/library");
  return data;
}

export async function addToLibrary(item: Omit<LibraryItem, "added_at">) {
  const { data } = await api.put<LibraryItem>(`/library/${enc(item.meta_id)}`, {
    type: item.type,
    name: item.name,
    poster: item.poster ?? null,
    poster_shape: item.poster_shape ?? null,
  });
  return data;
}

export async function removeFromLibrary(metaId: string) {
  await api.delete(`/library/${enc(metaId)}`);
}
