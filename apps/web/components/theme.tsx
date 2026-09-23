"use client";

import { useEffect, useSyncExternalStore } from "react";

import { THEME_COOKIE, THEMES, themeById, type ThemeId } from "@/lib/themes";

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function currentTheme(): ThemeId {
  return themeById(document.documentElement.dataset.theme).id;
}

export function applyTheme(id: ThemeId) {
  const theme = themeById(id);
  document.cookie = `${THEME_COOKIE}=${theme.id}; path=/; max-age=31536000; samesite=lax`;
  if (theme.fonts && !document.getElementById(`theme-font-${theme.id}`)) {
    const link = document.createElement("link");
    link.id = `theme-font-${theme.id}`;
    link.rel = "stylesheet";
    link.href = theme.fonts;
    document.head.appendChild(link);
  }
  document.documentElement.dataset.theme = theme.id;
}

export function ThemePicker() {
  const current = useSyncExternalStore(subscribe, currentTheme, () => "classic" as ThemeId);
  return (
    <div className="theme-picker" role="group" aria-label="Theme">
      <div className="menu-label">Theme</div>
      {THEMES.map((theme) => (
        <button
          aria-pressed={theme.id === current}
          className="menu-item theme-option"
          key={theme.id}
          onClick={() => applyTheme(theme.id)}
          type="button"
        >
          <span aria-hidden="true" className="theme-swatch">
            {theme.swatch.map((color) => (
              <i key={color} style={{ background: color }} />
            ))}
          </span>
          <span className="theme-option-text">
            <strong>{theme.name}</strong>
            <span>{theme.tagline}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

const CONFETTI = ["#ff5fa2", "#ffd23f", "#3ec5ff", "#5ce1a6", "#8b5cf6", "#ff8a3d"];

function burst(x: number, y: number) {
  const layer = document.createElement("div");
  layer.className = "confetti";
  layer.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 70; index += 1) {
    const piece = document.createElement("i");
    const angle = Math.random() * Math.PI * 2;
    const distance = 120 + Math.random() * 260;
    piece.style.left = `${x}px`;
    piece.style.top = `${y}px`;
    piece.style.background = CONFETTI[index % CONFETTI.length] as string;
    piece.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    piece.style.setProperty("--dy", `${Math.sin(angle) * distance - 160}px`);
    piece.style.setProperty("--spin", `${Math.random() * 900 - 450}deg`);
    piece.style.animationDelay = `${Math.random() * 80}ms`;
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1800);
}

/**
 * Theme behavior that CSS cannot do alone: Bubblegum throws confetti from
 * buttons marked data-confetti, and The Melt's logo eye follows the pointer.
 */
export function ThemeEffects() {
  useEffect(() => {
    const theme = () => document.documentElement.dataset.theme;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    function onSubmit(event: SubmitEvent) {
      if (theme() !== "playful" || reduced.matches) return;
      const button = event.submitter;
      if (!(button instanceof HTMLElement) || button.dataset.confetti === undefined) return;
      const box = button.getBoundingClientRect();
      burst(box.left + box.width / 2, box.top + box.height / 2);
    }
    let frame = 0;
    function onMove(event: PointerEvent) {
      if (theme() !== "weird" || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        for (const eye of document.querySelectorAll<HTMLElement>(".logo-eye")) {
          const box = eye.getBoundingClientRect();
          const dx = event.clientX - (box.left + box.width / 2);
          const dy = event.clientY - (box.top + box.height / 2);
          const length = Math.hypot(dx, dy) || 1;
          const reach = Math.min(1, length / 200);
          eye.style.setProperty("--look-x", ((dx / length) * reach).toFixed(3));
          eye.style.setProperty("--look-y", ((dy / length) * reach).toFixed(3));
        }
      });
    }
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
