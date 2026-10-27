import { Puzzle } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function AddonLogo({ src, name, className }: { src?: string; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cn(
        "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted",
        className,
      )}
    >
      {src && !failed ? (
        <img src={src} alt="" className="size-full object-contain" onError={() => setFailed(true)} />
      ) : (
        <Puzzle className="size-5 text-muted-foreground" aria-label={name} />
      )}
    </div>
  );
}
