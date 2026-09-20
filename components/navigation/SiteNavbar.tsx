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
};

const navigation = [
  { href: "/", label: "Home" },
  { href: "/chat", label: "Chat" },
  { href: "/projects", label: "Projects" },
];

export function SiteNavbar({
  projects = [],
  selectedProjectSlug,
  onProjectChange,
  presence = "present",
  accountLabel = "Account",
  onAccountClick,
}: SiteNavbarProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [darkTheme, setDarkTheme] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  const toggleTheme = () => {
    const next = !darkTheme;
    setDarkTheme(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
  };

  return (
    <header className="site-navbar">
      <Link className="site-navbar__brand" href="/" aria-label="Korben home">KORBEN</Link>
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
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={isActive(item.href) ? "active" : undefined}
              aria-current={isActive(item.href) ? "page" : undefined}
            >{item.label}</Link>
          ))}
        </nav>
        <div className="site-navbar__actions">
          {projects.length > 0 && selectedProjectSlug && onProjectChange ? (
            <label className="site-navbar__project">
              <span>Project</span>
              <select value={selectedProjectSlug} onChange={(event) => onProjectChange(event.target.value)} aria-label="Choose active project">
                {projects.map((project) => <option value={project.slug} key={project.id}>{project.name}</option>)}
              </select>
            </label>
          ) : null}
          <button className="site-navbar__icon" type="button" onClick={toggleTheme} aria-label={`Switch to ${darkTheme ? "light" : "dark"} theme`}>
            <span aria-hidden="true">{darkTheme ? "☾" : "☀"}</span>
          </button>
          <span className={`site-navbar__presence ${presence}`}><i aria-hidden="true" />{presence}</span>
          {onAccountClick ? <button className="site-navbar__account" type="button" onClick={onAccountClick}>{accountLabel}</button> : null}
        </div>
      </div>
    </header>
  );
}
