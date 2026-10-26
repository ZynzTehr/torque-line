"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

type Theme = "dark" | "light" | "system";
const KEY = "torqueline_theme";

/** Runs before paint (see layout.tsx) so the saved theme never flashes. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

function apply(theme: Theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from storage after hydration
      if (saved === "dark" || saved === "light") setTheme(saved);
    } catch { /* storage unavailable: follow the system */ }
  }, []);
  const choose = (next: Theme) => {
    setTheme(next);
    apply(next);
    try { localStorage.setItem(KEY, next); } catch { /* not remembered */ }
  };
  const options: { value: Theme; label: string; icon: "moon" | "sun" | "monitor" }[] = [
    { value: "dark", label: "Dark", icon: "moon" },
    { value: "light", label: "Light", icon: "sun" },
    { value: "system", label: "Auto", icon: "monitor" },
  ];
  return (
    <div className="theme-switcher" role="radiogroup" aria-label="Theme">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={theme === o.value}
          className={`theme-btn${theme === o.value ? " active" : ""}`} onClick={() => choose(o.value)}>
          <Icon name={o.icon} /> {o.label}
        </button>
      ))}
    </div>
  );
}
