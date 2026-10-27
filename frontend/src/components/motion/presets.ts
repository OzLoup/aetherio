// Spring presets (from Amicro, MIT).
export const springs = {
  snappy: { type: "spring", stiffness: 400, damping: 28, mass: 0.8 },
  smooth: { type: "spring", stiffness: 220, damping: 24, mass: 1 },
  gentle: { type: "spring", stiffness: 120, damping: 14, mass: 1 },
} as const;

/** easeOutExpo, Amicro's default for entrances. */
export const easeOutExpo = [0.16, 1, 0.3, 1] as const;
