"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion, type PanInfo } from "motion/react";
import { Icon } from "@/components/Icon";
import { useMediaQuery } from "./useMediaQuery";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), a[href]";

/**
 * Dialog on wide screens, bottom sheet on phones. Swipe the sheet down (or tap outside, press
 * Escape, or use the close button) to dismiss. Focus is trapped inside and restored on close.
 */
export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery("(max-width: 767px)");
  const reduce = useReducedMotion();
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("input:not([type='file']):not([disabled]), select, textarea, .modal-close");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length);
      const head = items[0], tail = items.at(-1);
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail?.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 700) onClose();
  };

  return createPortal(
    <div className="modal-overlay max-md:items-end max-md:p-0" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal max-md:max-h-[92dvh] max-md:max-w-none max-md:rounded-b-none max-md:pb-[env(safe-area-inset-bottom)]"
        drag={phone ? "y" : false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        dragListener={phone}
        onDragEnd={phone ? onDragEnd : undefined}
        initial={phone && !reduce ? { y: 80, opacity: 0 } : { opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={reduce ? { duration: 0.1 } : { type: "spring", stiffness: 500, damping: 40 }}
      >
        {phone && <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-white/20" aria-hidden="true" />}
        <div className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onClose}><Icon name="x" /></button>
        </div>
        {/* Scrolling content must not start a dismiss drag. */}
        <div className="modal-body" onPointerDownCapture={(e) => e.stopPropagation()}>{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </motion.div>
    </div>,
    document.body,
  );
}
