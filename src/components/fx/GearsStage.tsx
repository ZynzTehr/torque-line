"use client";

import { useEffect, useRef } from "react";
import { GEARS_SVG, GEAR_TRANSFORMS, calculateGearAngles, isGearTheme } from "./gears";

const THEME_KEY = "torqueline_gear_style";

/** Applies the saved gear theme (a per-viewer preference). Storage failures fall back to the default. */
export function applySavedGearTheme() {
  let saved: string | null = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* private mode or blocked storage */ }
  document.documentElement.setAttribute("data-gear-style", isGearTheme(saved) ? saved : "blueprint");
}

export function setGearTheme(theme: string) {
  const value = isGearTheme(theme) ? theme : "blueprint";
  try { localStorage.setItem(THEME_KEY, value); } catch { /* preference simply isn't remembered */ }
  document.documentElement.setAttribute("data-gear-style", value);
}

/**
 * Background gears that turn with scroll. While scrolling, the element matching `dimSelector`
 * gets `is-scrolling` so the gears read through; it clears 400 ms after scrolling stops.
 */
export function GearsStage({ dimSelector = "#main-content" }: { dimSelector?: string }) {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applySavedGearTheme();
    const stage = stageRef.current;
    if (!stage) return;
    const center = stage.querySelector<SVGGElement>("#gear-center");
    const topRight = stage.querySelector<SVGGElement>("#gear-top-right");
    const bottomLeft = stage.querySelector<SVGGElement>("#gear-bottom-left");
    if (!center || !topRight || !bottomLeft) return;

    const update = () => {
      const a = calculateGearAngles(window.scrollY);
      center.setAttribute("transform", GEAR_TRANSFORMS.center(a.thetaCenter));
      topRight.setAttribute("transform", GEAR_TRANSFORMS.topRight(a.thetaTopRight));
      bottomLeft.setAttribute("transform", GEAR_TRANSFORMS.bottomLeft(a.thetaBottomLeft));
    };
    update();

    let ticking = false;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      const main = document.querySelector(dimSelector);
      main?.classList.add("is-scrolling");
      stage.classList.add("scroll-highlight");
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => {
        main?.classList.remove("is-scrolling");
        stage.classList.remove("scroll-highlight");
      }, 400);
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => { update(); ticking = false; });
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(stopTimer);
    };
  }, [dimSelector]);

  return (
    <div
      ref={stageRef}
      id="dashboard-gears-stage"
      className="dashboard-gears-stage"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: GEARS_SVG }}
    />
  );
}
