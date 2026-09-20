"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type ProjectOption = { id: string; name: string; slug: string };

type SiteNavbarProps = {
  projects?: ProjectOption[];
  selectedProjectSlug?: string;
  onProjectChange?: (slug: string) => void;
  presence?: "present" | "idle" | "away";
  accountLabel?: string;
  onAccountClick?: () => void;
  currentView?: string;
  onViewChange?: (view: string) => void;
  onToggleTheme?: () => void;
};

const appViews = [
  { view: "command", label: "Home" },
  { view: "work", label: "Tasks" },
  { view: "workstream", label: "Delegation" },
  { view: "network", label: "Agents" },
  { view: "focus", label: "Focus" },
  { view: "brain", label: "Library" },
];

export function SiteNavbar({
  projects = [],
  selectedProjectSlug,
  onProjectChange,
  presence = "present",
  accountLabel = "Account",
  onAccountClick,
  currentView,
  onViewChange,
  onToggleTheme,
}: SiteNavbarProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMenuOpen(false), [pathname, currentView]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };

    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const navigateView = (view: string) => {
    setMenuOpen(false);
    if (onViewChange) {
      onViewChange(view);
      return;
    }
    const suffix = view === "command" ? "" : `?view=${encodeURIComponent(view)}`;
    window.location.assign(`/${suffix}`);
  };

  const activeView = (view: string) => {
    if (pathname !== "/") return false;
    return (currentView || "command") === view;
  };

  return (
    <header className="site-navbar">
      <button
        className="site-navbar__brand"
        type="button"
        onClick={() => navigateView("command")}
        aria-label="Korben home"
      >
        KORBEN
      </button>

      <button
        className="site-navbar__menu"
        type="button"
        aria-expanded={menuOpen}
        aria-controls="site-navigation"
        aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
        onClick={() => setMenuOpen((value) => !value)}
      >
        <span aria-hidden="true">☰</span>
      </button>

      <div className={`site-navbar__panel ${menuOpen ? "is-open" : ""}`} ref={menuRef}>
        <nav id="site-navigation" className="site-navbar__links" aria-label="Primary navigation">
          {appViews.map((item) => (
            <button
              key={item.view}
              type="button"
              className={activeView(item.view) ? "active" : undefined}
              aria-current={activeView(item.view) ? "page" : undefined}
              onClick={() => navigateView(item.view)}
            >
              {item.label}
            </button>
          ))}

          <Link
            href="/chat"
            className={pathname === "/chat" ? "active" : undefined}
            aria-current={pathname === "/chat" ? "page" : undefined}
          >
            Chat
          </Link>

          <Link
            href="/projects"
            className={pathname === "/projects" ? "active" : undefined}
            aria-current={pathname === "/projects" ? "page" : undefined}
          >
            Projects
          </Link>
        </nav>

        <div className="site-navbar__actions">
          {projects.length > 0 && selectedProjectSlug && onProjectChange ? (
            <label className="site-navbar__project">
              <span>Project</span>
              <select
                value={selectedProjectSlug}
                onChange={(event) => onProjectChange(event.target.value)}
                aria-label="Choose active project"
              >
                {projects.map((project) => (
                  <option value={project.slug} key={project.id}>{project.name}</option>
                ))}
                <option value="__manage__">Manage projects…</option>
              </select>
            </label>
          ) : null}

          {onToggleTheme ? (
            <button
              className="site-navbar__icon"
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle light and dark mode"
            >
              <span aria-hidden="true">☼</span>
            </button>
          ) : null}

          <span className={`site-navbar__presence ${presence}`}>
            <i aria-hidden="true" />
            <span className="site-navbar__presence-label">{presence}</span>
          </span>

          {onAccountClick ? (
            <button className="site-navbar__account" type="button" onClick={onAccountClick}>
              {accountLabel}
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
