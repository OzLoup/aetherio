import { api } from "@/api/client";

/** -1 no me gusta, 1 me gusta, 2 me encanta. */
export type RatingValue = -1 | 1 | 2;

export interface RatingEntry {
  meta_id: string;
  type: string;
  name: string;
  poster?: string | null;
  genres: string[];
  rating: RatingValue;
  updated_at: string;
}

const enc = encodeURIComponent;

export async function getRatings() {
  const { data } = await api.get<RatingEntry[]>("/ratings");
  return data;
}

export async function rateTitle(entry: Omit<RatingEntry, "updated_at">) {
  const { meta_id, ...body } = entry;
  const { data } = await api.put<RatingEntry>(`/ratings/${enc(meta_id)}`, body);
  return data;
}

export async function unrateTitle(metaId: string) {
  await api.delete(`/ratings/${enc(metaId)}`);
}
