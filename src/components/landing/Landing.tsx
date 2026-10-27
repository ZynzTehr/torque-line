"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { PixelRippleButton } from "@/components/fx/PixelRippleButton";
import { BRAND_ITEMS, FEATURE_ITEMS, type BrandItem, type FeatureItem } from "./landingData";

/**
 * Landing sequence (ported timeline): the logo draws itself (0s), docks top-left (1.5s),
 * the wordmark draws beside it, then the hero and carousels fade in (2.6s).
 * Under reduced motion every step happens immediately.
 */
export function Landing({ primaryHref, primaryLabel }: { primaryHref: string; primaryLabel: string }) {
  const router = useRouter();
  const [docked, setDocked] = useState(false);
  const [heroVisible, setHeroVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    router.prefetch(primaryHref);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timers.current.push(setTimeout(() => setDocked(true), reduced ? 0 : 1500));
    timers.current.push(setTimeout(() => setHeroVisible(true), reduced ? 0 : 2600));
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, [router, primaryHref]);

  const enter = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timers.current.push(setTimeout(() => router.push(primaryHref), reduced ? 0 : 200));
  }, [leaving, router, primaryHref]);

  return (
    <div className={leaving ? "landing-fade-out" : undefined}>
      <div className="landing-page" id="landing-stage">
        <div className="landing-grid-bg" />

        <div className={`landing-brand-container${docked ? " brand-docked" : ""}`} id="landing-brand">
          <div className="landing-logo-box">
            <LogoMark />
          </div>
          <div className="landing-text-box">
            <svg className="landing-brand-text-svg" viewBox="0 0 178 50" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={BRAND.name}>
              <text x="0" y="39" className="brand-draw-text">{BRAND.name}</text>
            </svg>
          </div>
        </div>

        <div className={`landing-hero${heroVisible ? " hero-visible" : ""}`} id="landing-hero">
          <div className="landing-hero-center">
            <p className="landing-eyebrow">Commercial fleet maintenance</p>
            <h1 className="landing-tagline">Stay Ahead of Overdue Service</h1>
            <PixelRippleButton onActivate={enter} disabled={leaving}>
              <span>{primaryLabel}</span>
              <svg className="pixel-arrow-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </PixelRippleButton>
          </div>

          <div className="landing-carousels-wrapper">
            <Carousel direction="rtl" label={`${BRAND.name} capabilities`}>
              {FEATURE_ITEMS.map((item) => <FeatureCard key={item.title} item={item} />)}
            </Carousel>
            <Carousel direction="ltr" label="Equipment and powertrains we track">
              {BRAND_ITEMS.map((item) => <BrandCard key={item.name} item={item} />)}
            </Carousel>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Two identical groups make the infinite scroll seamless; the copy is hidden from assistive tech. */
function Carousel({ direction, label, children }: { direction: "rtl" | "ltr"; label: string; children: React.ReactNode }) {
  return (
    <div className={`carousel-container carousel-${direction}`} aria-label={label} role="region">
      <div className="carousel-track">
        <div className="carousel-group">{children}</div>
        <div className="carousel-group" aria-hidden="true">{children}</div>
      </div>
    </div>
  );
}

function FeatureCard({ item }: { item: FeatureItem }) {
  return (
    <div className="carousel-card feature-carousel-card">
      <div className="carousel-card-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: item.svg }} />
      <div className="carousel-card-content">
        <div className="carousel-card-header">
          <span className="carousel-card-title">{item.title}</span>
          {item.badge ? <span className="carousel-card-badge">{item.badge}</span> : null}
        </div>
        <div className="carousel-card-sub">{item.sub}</div>
      </div>
    </div>
  );
}

function BrandCard({ item }: { item: BrandItem }) {
  return (
    <div
      className="carousel-card brand-carousel-card"
      title={item.name}
      role="img"
      aria-label={item.name}
      dangerouslySetInnerHTML={{ __html: item.svg }}
    />
  );
}

function LogoMark() {
  return (
    <svg className="landing-logo-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <filter id="cyan-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <path className="draw-path shield-path" d="M 60 12 L 102 32 L 102 88 L 60 108 L 18 88 L 18 32 Z" fill="rgba(10, 14, 23, 0.85)" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" filter="url(#cyan-glow)" />
      <path className="draw-path truck-path" d="M 36 62 L 36 44 L 68 44 L 68 50 L 82 50 L 88 58 L 88 62" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="draw-path wheel-path" cx="46" cy="64" r="5" fill="none" stroke="#22d3ee" strokeWidth="2" />
      <circle className="draw-path wheel-path" cx="78" cy="64" r="5" fill="none" stroke="#22d3ee" strokeWidth="2" />
      <path className="draw-path pulse-path" d="M 22 76 L 42 76 L 49 60 L 58 92 L 67 36 L 76 84 L 83 76 L 98 76" fill="none" stroke="#22d3ee" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#cyan-glow)" />
    </svg>
  );
}
