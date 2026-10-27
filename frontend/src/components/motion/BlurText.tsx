import { motion } from "motion/react";

/** Characters come into focus one after another. (Amicro blur-text, MIT —
 * adapted: animates on mount; words stay together so titles wrap well.) */
export function BlurText({ text, className, stagger = 0.018 }: { text: string; className?: string; stagger?: number }) {
  const words = text.split(" ");
  let index = 0;
  return (
    <motion.span
      initial="hidden"
      animate="visible"
      variants={{ hidden: {}, visible: { transition: { staggerChildren: stagger } } }}
      className={className}
      aria-label={text}
    >
      {words.map((word, w) => (
        <span key={w} className="inline-block whitespace-nowrap" aria-hidden="true">
          {Array.from(word).map((char) => (
            <motion.span
              key={index++}
              className="inline-block"
              variants={{
                hidden: { opacity: 0, filter: "blur(8px)" },
                visible: { opacity: 1, filter: "blur(0px)", transition: { duration: 0.5, ease: "easeOut" } },
              }}
            >
              {char}
            </motion.span>
          ))}
          {w < words.length - 1 && " "}
        </span>
      ))}
    </motion.span>
  );
}
