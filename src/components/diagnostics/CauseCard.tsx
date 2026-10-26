"use client";

import { useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from "motion/react";
import { markCauseAction } from "@/app/(app)/ai-actions";

export interface CauseView {
  id: string; rank: number; name: string; likelihood: "high" | "medium" | "low"; why: string; howToCheck: string;
  costTier: "free" | "low" | "medium" | "high"; safetyCritical: boolean; needsShop: boolean; tried: boolean; ruledOut: boolean;
}

const LIKELIHOOD: Record<CauseView["likelihood"], string> = { high: "badge-red", medium: "badge-yellow", low: "badge-neutral" };
const COST: Record<CauseView["costTier"], string> = { free: "Free to check", low: "$", medium: "$$", high: "$$$" };
const THRESHOLD = 110;

/** Swipe right: tried it. Swipe left: rule it out. The buttons do the same. */
export function CauseCard({ cause, disabled }: { cause: CauseView; disabled?: boolean }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const triedOpacity = useTransform(x, [20, THRESHOLD], [0, 1]);
  const ruleOpacity = useTransform(x, [-THRESHOLD, -20], [1, 0]);
  const [error, setError] = useState<string | null>(null);

  const mark = async (status: "tried" | "ruled_out" | "open") => {
    setError(null);
    const r = await markCauseAction(cause.id, status);
    if (!r.ok) setError(r.message);
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const dx = info.offset.x;
    animate(x, 0, reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 });
    if (dx > THRESHOLD) mark("tried");
    else if (dx < -THRESHOLD) mark("ruled_out");
  };

  const state = cause.ruledOut ? "Ruled out" : cause.tried ? "Tried, didn't fix it" : null;
  return (
    <li className="swipe-row relative overflow-hidden rounded-[var(--radius-lg)]">
      {!cause.ruledOut && !disabled && (
        <>
          <motion.div aria-hidden className="bg-warn/20 text-warn absolute inset-0 flex items-center pl-5 text-sm font-semibold" style={{ opacity: triedOpacity }}>Tried it</motion.div>
          <motion.div aria-hidden className="bg-danger/20 text-danger absolute inset-0 flex items-center justify-end pr-5 text-sm font-semibold" style={{ opacity: ruleOpacity }}>Rule out</motion.div>
        </>
      )}
      <motion.article className={`card relative${cause.ruledOut ? " opacity-55" : ""}`} style={{ x, touchAction: "pan-y" }}
        drag={cause.ruledOut || disabled ? false : "x"} dragConstraints={{ left: 0, right: 0 }} dragElastic={0.5} onDragEnd={onDragEnd}
        aria-label={`${cause.rank}. ${cause.name}`}>
        <header className="flex flex-wrap items-center gap-2">
          <span className="text-secondary font-mono text-xs">#{cause.rank}</span>
          <h3 className={`text-base${cause.ruledOut ? " line-through" : ""}`}>{cause.name}</h3>
          <span className={`badge ${LIKELIHOOD[cause.likelihood]}`}>{cause.likelihood} likelihood</span>
          <span className="badge badge-neutral">{COST[cause.costTier]}</span>
          {cause.needsShop && <span className="badge badge-blue">Shop job</span>}
          {cause.safetyCritical && <span className="badge badge-red">Safety: stop and inspect</span>}
          {state && <span className="badge badge-neutral">{state}</span>}
        </header>
        <p className="text-secondary mt-2 text-sm">{cause.why}</p>
        <p className="mt-2 text-sm"><strong>How to check:</strong> {cause.howToCheck}</p>
        {!disabled && (
          <div className="mt-3 flex flex-wrap gap-2">
            {cause.ruledOut || cause.tried
              ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => mark("open")}>Undo</button>
              : <>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => mark("tried")}>Tried it, no fix</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => mark("ruled_out")}>Rule out</button>
                </>}
          </div>
        )}
        {error && <p role="alert" className="text-danger mt-2 text-xs">{error}</p>}
      </motion.article>
    </li>
  );
}
