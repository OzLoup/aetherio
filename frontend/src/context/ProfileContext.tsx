import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getProfileId, setProfileId } from "@/api/client";
import type { Profile, ProfileColor, ProfileSettings } from "@/api/types";
import { getLanguage } from "@/i18n";
import type { LanguageCode } from "@/lib/languages";
import { useAuth } from "./AuthContext";

interface ProfileInput {
  name: string;
  color: ProfileColor;
  language: LanguageCode;
}

interface ProfileContextValue {
  profiles: Profile[];
  current: Profile | null;
  loading: boolean;
  select: (id: number) => void;
  /** Back to "¿Quién está viendo?" without logging out. */
  clearSelection: () => void;
  create: (input: ProfileInput & { copyAddonsFrom?: number }) => Promise<Profile>;
  update: (id: number, input: ProfileSettings) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(getProfileId);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Profile[]>("/profiles");
      setProfiles(data);
      // A remembered profile that was deleted (maybe from another device).
      setCurrentId((id) => {
        if (id !== null && !data.some((p) => p.id === id)) {
          setProfileId(null);
          return null;
        }
        return id;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // While the session is still being restored after a reload, `user` is
    // briefly null: don't treat that as "logged out" (it used to wipe the
    // chosen profile and send everyone to "¿Quién está viendo?").
    if (authLoading) return;
    if (user) {
      setLoading(true);
      setCurrentId(getProfileId());
      load();
    } else {
      setProfiles([]);
      setCurrentId(null);
      setLoading(false);
    }
  }, [user, authLoading, load]);

  function select(id: number) {
    setProfileId(id);
    setCurrentId(id);
  }

  function clearSelection() {
    setProfileId(null);
    setCurrentId(null);
  }

  async function create({ name, color, language, copyAddonsFrom }: ProfileInput & { copyAddonsFrom?: number }) {
    const { data } = await api.post<Profile>("/profiles", {
      name,
      color,
      language,
      // New profiles start in the language the app is showing right now.
      ui_language: getLanguage(),
      copy_addons_from: copyAddonsFrom ?? null,
    });
    setProfiles((prev) => [...prev, data]);
    return data;
  }

  async function update(id: number, input: ProfileSettings) {
    const { data } = await api.patch<Profile>(`/profiles/${id}`, input);
    setProfiles((prev) => prev.map((p) => (p.id === id ? data : p)));
  }

  async function remove(id: number) {
    await api.delete(`/profiles/${id}`);
    setProfiles((prev) => prev.filter((p) => p.id !== id));
    if (currentId === id) clearSelection();
  }

  const current = profiles.find((p) => p.id === currentId) ?? null;

  return (
    <ProfileContext.Provider
      value={{ profiles, current, loading, select, clearSelection, create, update, remove }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfiles(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfiles debe usarse dentro de un ProfileProvider");
  return ctx;
}
