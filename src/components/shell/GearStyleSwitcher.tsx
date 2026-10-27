"use client";

import { useEffect, useState } from "react";

/** The four gear finishes from the original app; the CSS keys off html[data-gear-style]. */
export const GEAR_STYLES = [
  { value: "blueprint", label: "Cyan" },
  { value: "steel", label: "Steel" },
  { value: "amber", label: "Amber" },
  { value: "stealth", label: "Stealth" },
] as const;
export type GearStyle = (typeof GEAR_STYLES)[number]["value"];
const KEY = "torqueline_gear_style";
const VALUES: readonly string[] = GEAR_STYLES.map((s) => s.value);

/** Runs before paint (see layout.tsx) so the saved gear finish never flashes. */
export const GEAR_BOOT_SCRIPT = `try{var g=localStorage.getItem("${KEY}");if(${JSON.stringify(VALUES)}.indexOf(g)>=0)document.documentElement.setAttribute("data-gear-style",g)}catch(e){}`;

export function GearStyleSwitcher() {
  const [style, setStyle] = useState<GearStyle>("blueprint");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from storage after hydration
      if (saved && VALUES.includes(saved)) setStyle(saved as GearStyle);
    } catch { /* storage unavailable: default finish */ }
  }, []);
  const choose = (next: GearStyle) => {
    setStyle(next);
    document.documentElement.setAttribute("data-gear-style", next);
    try { localStorage.setItem(KEY, next); } catch { /* not remembered */ }
  };
  return (
    <div className="gear-theme-switcher" role="radiogroup" aria-label="Gear style">
      {GEAR_STYLES.map((s) => (
        <button key={s.value} type="button" role="radio" aria-checked={style === s.value}
          className={`gear-theme-btn${style === s.value ? " active" : ""}`} onClick={() => choose(s.value)}>
          {s.label}
        </button>
      ))}
    </div>
  );
}
