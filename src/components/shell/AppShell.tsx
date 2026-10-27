"use client";

import { Suspense, useRef, useState, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { GearsStage } from "@/components/fx/GearsStage";
import { BRAND } from "@/lib/brand";
import { classifySwipe, navDirection, SECTIONS, sectionIndex } from "./sections";
import { SignOutButton } from "./SignOutButton";
import { ThemeSwitcher } from "./ThemeSwitcher";

/** Elements where a horizontal drag means something else, so section swiping stays out of the way. */
const NO_SWIPE = "[data-no-swipe], input, textarea, select, [role='slider'], .swipe-row";

/**
 * touch-pan-y on <main>: without it, mobile browsers claim horizontal drags as panning and send
 * pointercancel, so section swipes never complete. Sideways-scrolling regions inside (the register
 * table, photo strips) are their own scroll containers and keep native horizontal panning.
 *
 * The shell is static so it lands in the prerendered page; only the active-link highlight
 * reads the path (behind Suspense), and swipes read it from the browser at gesture time.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const closeMenu = () => setMenuOpen(false);

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" || (e.target as Element).closest(NO_SWIPE)) { start.current = null; return; }
    start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onPointerUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const swipe = classifySwipe({ dx: e.clientX - s.x, dy: e.clientY - s.y, ms: performance.now() - s.t });
    const path = window.location.pathname;
    const active = sectionIndex(path);
    // Only swipe between top-level sections; detail pages use the back link.
    if (swipe === 0 || active < 0 || path !== SECTIONS[active].href) return;
    const target = SECTIONS[active - swipe];
    if (!target) return;
    navDirection.current = -swipe;
    router.push(target.href);
  };

  return (
    <div id="app" className="dashboard-app">
      <button className="mobile-toggle" aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="sidebar"
        onClick={() => setMenuOpen((v) => !v)}>
        <Icon name="menu" />
      </button>

      <aside id="sidebar" className={`sidebar${menuOpen ? " open" : ""}`}>
        <div className="sidebar-brand">
          <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="#0a0e17" /><polyline points="4,18 10,18 13,10 16,24 19,14 22,18 28,18" fill="none" stroke="#22d3ee" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="sidebar-brand-name text-lg font-bold">{BRAND.name}</span>
        </div>
        <nav className="sidebar-nav" aria-label="Main">
          <Suspense fallback={<SidebarLinks pathname="" onNavigate={closeMenu} />}>
            <ActiveSidebarLinks onNavigate={closeMenu} />
          </Suspense>
        </nav>
        <div className="sidebar-footer">
          <span className="text-secondary mb-1.5 block text-xs font-semibold">Theme</span>
          <ThemeSwitcher />
          <SignOutButton className="nav-item mt-2" />
        </div>
      </aside>
      {menuOpen && <button className="fixed inset-0 z-[90] bg-black/40 md:hidden" aria-label="Close navigation" onClick={closeMenu} />}

      <GearsStage />
      <main id="main-content" className="main-content touch-pan-y pb-24 md:pb-0" onPointerDown={onPointerDown} onPointerUp={onPointerUp}
        onPointerCancel={() => { start.current = null; }}>
        {children}
      </main>

      <nav className="bg-surface/95 border-line fixed inset-x-0 bottom-0 z-[80] grid grid-cols-4 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Sections">
        <Suspense fallback={<TabLinks pathname="" />}><ActiveTabLinks /></Suspense>
      </nav>
    </div>
  );
}

function ActiveSidebarLinks({ onNavigate }: { onNavigate: () => void }) {
  return <SidebarLinks pathname={usePathname()} onNavigate={onNavigate} />;
}
function ActiveTabLinks() {
  return <TabLinks pathname={usePathname()} />;
}

function SidebarLinks({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const active = sectionIndex(pathname);
  return (
    <>
      <div className="nav-section-label">Fleet</div>
      {SECTIONS.map((s, i) => (
        <Link key={s.href} href={s.href} className={`nav-item${i === active ? " active" : ""}`}
          aria-current={i === active ? "page" : undefined}
          onClick={() => { navDirection.current = active < 0 ? 0 : Math.sign(i - active); onNavigate(); }}>
          <Icon name={s.icon} /><span>{s.label}</span>
        </Link>
      ))}
      <div className="nav-section-label">System</div>
      <Link href="/settings" className={`nav-item${pathname === "/settings" ? " active" : ""}`}
        aria-current={pathname === "/settings" ? "page" : undefined} onClick={onNavigate}>
        <Icon name="settings" /><span>Settings</span>
      </Link>
    </>
  );
}

function TabLinks({ pathname }: { pathname: string }) {
  const active = sectionIndex(pathname);
  return (
    <>
      {SECTIONS.map((s, i) => (
        <Link key={s.href} href={s.href} aria-current={i === active ? "page" : undefined}
          onClick={() => { navDirection.current = active < 0 ? 0 : Math.sign(i - active); }}
          className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.7rem] font-medium ${i === active ? "text-accent" : "text-muted"}`}>
          <Icon name={s.icon} className="text-lg" />
          {s.label}
        </Link>
      ))}
    </>
  );
}
