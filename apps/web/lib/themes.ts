export const THEME_COOKIE = "forgit-theme";
export const MODE_COOKIE = "forgit-mode";

export type ModePreference = "system" | "light" | "dark";

export function modePreference(value: string | undefined): ModePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * Runs in <head> before first paint: resolves "system" to light or dark from
 * the OS setting and keeps following it, so there is never a flash of the
 * wrong mode.
 */
export const MODE_SCRIPT = `(function(){try{var d=document.documentElement,m=window.matchMedia("(prefers-color-scheme: dark)");function s(){var p=d.dataset.modePref;d.dataset.mode=p==="light"||p==="dark"?p:(m.matches?"dark":"light")}s();m.addEventListener("change",s);new MutationObserver(s).observe(d,{attributeFilter:["data-mode-pref"]})}catch(e){}})()`;

export type ThemeId = "classic" | "retro" | "playful" | "animals" | "weird";

export type Theme = {
  id: ThemeId;
  name: string;
  tagline: string;
  /** Google Fonts stylesheet, loaded only while the theme is active. */
  fonts?: string;
  /** Three colors for the picker swatch. */
  swatch: [string, string, string];
  /** What the theme becomes in each mode, shown in the picker. */
  light: string;
  dark: string;
};

export const THEMES: Theme[] = [
  {
    id: "classic",
    light: "Porcelain",
    dark: "Enamel night",
    name: "Classic",
    tagline: "Enamel and brass",
    swatch: ["#14324d", "#f0c56a", "#f6f7f9"],
  },
  {
    id: "retro",
    light: "Dot-matrix printout",
    dark: "Green screen",
    name: "Phosphor '84",
    tagline: "A green screen that hums",
    fonts: "https://fonts.googleapis.com/css2?family=VT323&display=swap",
    swatch: ["#041006", "#39ff6a", "#ffb000"],
  },
  {
    id: "playful",
    light: "Sticker book",
    dark: "Glow in the dark",
    name: "Bubblegum",
    tagline: "Stickers, straws, confetti",
    fonts: "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap",
    swatch: ["#ff5fa2", "#ffd23f", "#3ec5ff"],
  },
  {
    id: "animals",
    light: "Morning trail",
    dark: "Night hike",
    name: "Field Guide",
    tagline: "Every repo has a critter",
    fonts:
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=Nunito:wght@400;600;700;800&display=swap",
    swatch: ["#2f5d3a", "#e9b949", "#f4eedf"],
  },
  {
    id: "weird",
    light: "Bone and pastel goo",
    dark: "Lava lamp void",
    name: "The Melt",
    tagline: "It is looking at you",
    fonts:
      "https://fonts.googleapis.com/css2?family=Rubik+Wet+Paint&family=Syne:wght@400;500;600;700;800&display=swap",
    swatch: ["#140a24", "#c6ff3d", "#ff7ac6"],
  },
];

export function themeById(id: string | undefined): Theme {
  return THEMES.find((theme) => theme.id === id) ?? (THEMES[0] as Theme);
}

const ANIMALS = [
  "🦊",
  "🦉",
  "🐢",
  "🦔",
  "🐙",
  "🦦",
  "🐝",
  "🦫",
  "🐸",
  "🦝",
  "🐧",
  "🦜",
  "🐌",
  "🦎",
  "🐿️",
  "🦙",
  "🐳",
  "🦩",
  "🐞",
  "🦭",
];

/** The same name always gets the same critter. */
export function animalFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return ANIMALS[hash % ANIMALS.length] as string;
}
