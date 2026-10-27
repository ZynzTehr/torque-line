"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { initPixelRippleButton, type PixelRippleOptions } from "./pixelRipple";

interface Props extends Omit<PixelRippleOptions, "onClick"> {
  children: ReactNode;
  /** Called after the ripple plays; the button disables itself afterwards to prevent double activation. */
  onActivate: () => void;
  disabled?: boolean;
  className?: string;
}

export function PixelRippleButton({ children, onActivate, disabled, className, ...options }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const activateRef = useRef(onActivate);
  useEffect(() => { activateRef.current = onActivate; }, [onActivate]);

  useEffect(() => {
    if (!ref.current) return;
    const handle = initPixelRippleButton(ref.current, { ...options, onClick: () => activateRef.current() });
    return () => handle.destroy();
    // Options are visual constants for the button's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pixel-ripple-wrapper">
      <button ref={ref} type="button" className={`pixel-ripple-btn ${className ?? ""}`} disabled={disabled}>
        <span className="pixel-ripple-label">{children}</span>
      </button>
    </div>
  );
}
