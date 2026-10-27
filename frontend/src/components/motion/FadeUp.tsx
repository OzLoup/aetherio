import { motion } from "motion/react";
import type { ReactNode } from "react";
import { easeOutExpo } from "./presets";

/** Entrance: fades in while rising a few pixels. (Amicro fade-up, MIT) */
export function FadeUp({
  children,
  delay = 0,
  duration = 0.6,
  y = 16,
  className,
}: {
  children: ReactNode;
  delay?: number;
  duration?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, delay, ease: easeOutExpo }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
