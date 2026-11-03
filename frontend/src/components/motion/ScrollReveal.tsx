import { motion } from "motion/react";
import type { ReactNode } from "react";
import { remoteMode } from "@/lib/spatialNav";
import { easeOutExpo } from "./presets";

/** Reveals once when scrolled into view. (Amicro scroll-reveal, MIT) */
export function ScrollReveal({ children, className, y = 24 }: { children: ReactNode; className?: string; y?: number }) {
  // TV remote: no reveal. Hidden (opacity 0) content below can't take focus,
  // so ↓ found nothing until the page scrolled; and TV boxes are slow.
  if (remoteMode()) return <div className={className}>{children}</div>;
  return (
    <motion.div
      initial={{ opacity: 0, y, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.6, ease: easeOutExpo }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
