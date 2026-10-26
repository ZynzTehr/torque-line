"use client";

import { motion, useReducedMotion } from "motion/react";
import { navDirection } from "@/components/shell/sections";

/** Re-mounts on every navigation; slides in from the side the user swiped or tapped toward. */
export default function SectionTransition({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const dir = navDirection.current;
  return (
    <motion.div
      initial={reduce || dir === 0 ? { opacity: 0 } : { opacity: 0, x: dir * 48 }}
      animate={{ opacity: 1, x: 0 }}
      transition={reduce ? { duration: 0.12 } : { type: "spring", stiffness: 420, damping: 38 }}
    >
      {children}
    </motion.div>
  );
}
