"use client";

import { useState, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, type PanInfo } from "motion/react";
import { Icon } from "@/components/Icon";
import { useMediaQuery } from "./useMediaQuery";

export interface RowAction {
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
}

const ACTION_WIDTH = 92;

/**
 * On phones, swipe a row left to reveal its actions; the "More" button does the same without a gesture.
 * On wider screens the actions are always visible inline.
 */
export function SwipeRow({ children, actions, label }: { children: ReactNode; actions: RowAction[]; label: string }) {
  const phone = useMediaQuery("(max-width: 767px)");
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const [open, setOpen] = useState(false);
  const width = ACTION_WIDTH * actions.length;

  const snap = (toOpen: boolean) => {
    setOpen(toOpen);
    animate(x, toOpen ? -width : 0, reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 42 });
  };
  const onDragEnd = (_: unknown, info: PanInfo) => snap(info.offset.x < -width / 2 || info.velocity.x < -500);
  const run = (action: RowAction) => { snap(false); action.onSelect(); };

  if (!phone) {
    return (
      <div className="swipe-row flex items-center gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <div className="flex shrink-0 gap-2">
          {actions.map((a) => (
            <button key={a.label} type="button" onClick={() => a.onSelect()}
              className={`btn btn-sm ${a.tone === "danger" ? "btn-ghost text-danger" : "btn-secondary"}`}>{a.label}</button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="swipe-row relative overflow-hidden rounded-[var(--radius-md)]">
      <div className="absolute inset-y-0 right-0 flex" style={{ width }} aria-hidden={!open}>
        {actions.map((a) => (
          <button key={a.label} type="button" tabIndex={open ? 0 : -1} onClick={() => run(a)}
            className={`flex-1 text-sm font-semibold ${a.tone === "danger" ? "bg-danger text-white" : "bg-elevated text-fg"}`}>
            {a.label}
          </button>
        ))}
      </div>
      <motion.div className="bg-card relative flex items-center gap-2" style={{ x, touchAction: "pan-y" }}
        drag="x" dragConstraints={{ left: -width, right: 0 }} dragElastic={0.08} onDragEnd={onDragEnd}>
        <div className="min-w-0 flex-1">{children}</div>
        <button type="button" className="btn btn-ghost btn-sm shrink-0" aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} actions for ${label}`} onClick={() => snap(!open)}>
          <Icon name="menu" />
        </button>
      </motion.div>
    </div>
  );
}
