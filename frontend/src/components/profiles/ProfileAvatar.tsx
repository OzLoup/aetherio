import { useState } from "react";
import { API_BASE_URL } from "@/api/client";
import type { Profile } from "@/api/types";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-8 rounded-md text-sm",
  md: "size-12 rounded-lg text-lg",
  lg: "size-24 rounded-xl text-4xl sm:size-32 sm:text-5xl",
} as const;

export function ProfileAvatar({
  profile,
  size = "md",
  className,
}: {
  profile: Pick<Profile, "name" | "color"> & { avatar_url?: string | null };
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const src = profile.avatar_url ? `${API_BASE_URL}${profile.avatar_url}` : null;
  if (src && broken !== src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        onError={() => setBroken(src)}
        className={cn("shrink-0 select-none object-cover", SIZES[size], className)}
        style={{ background: `var(--${profile.color})` }}
      />
    );
  }
  return (
    <div
      className={cn("flex shrink-0 select-none items-center justify-center font-bold text-white", SIZES[size], className)}
      style={{ background: `var(--${profile.color})` }}
      aria-hidden="true"
    >
      {profile.name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}
