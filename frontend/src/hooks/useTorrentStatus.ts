import { useEffect, useState } from "react";
import { getDebridAccount, torrentsStatus, type TorrentStatus } from "@/api/debrid";

export type TorrentStatusMap = Record<string, TorrentStatus & { download_id: number | null }>;

const POLL_MS = 8000;

/** Live progress of these torrents in the user's Real-Debrid (only those
 * already there). Polls while any is still downloading. `bump` forces a
 * fresh check (e.g. right after asking for a download). */
export function useTorrentStatus(hashes: string[], bump = 0): TorrentStatusMap {
  const [items, setItems] = useState<TorrentStatusMap>({});
  const key = [...new Set(hashes)].sort().join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let timer = 0;
    const list = key.split(",");
    const check = async () => {
      try {
        const account = await getDebridAccount();
        if (!account.connected || account.valid === false) return;
        const res = await torrentsStatus(list);
        if (cancelled) return;
        setItems(res.items);
        const active = Object.values(res.items).some((s) => !s.ready && !s.failed);
        if (active) timer = window.setTimeout(check, POLL_MS);
      } catch {
        if (!cancelled) timer = window.setTimeout(check, POLL_MS * 2);
      }
    };
    void check();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, bump]);

  return items;
}
