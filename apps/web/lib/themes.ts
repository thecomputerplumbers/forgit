export const THEME_COOKIE = "forgit-theme";

export type ThemeId = "classic" | "retro" | "playful" | "animals" | "weird";

export type Theme = {
  id: ThemeId;
  name: string;
  tagline: string;
  /** Google Fonts stylesheet, loaded only while the theme is active. */
  fonts?: string;
  /** Three colors for the picker swatch. */
  swatch: [string, string, string];
};

export const THEMES: Theme[] = [
  {
    id: "classic",
    name: "Classic",
    tagline: "Enamel and brass",
    swatch: ["#14324d", "#f0c56a", "#f6f7f9"],
  },
  {
    id: "retro",
    name: "Phosphor '84",
    tagline: "A green screen that hums",
    fonts: "https://fonts.googleapis.com/css2?family=VT323&display=swap",
    swatch: ["#041006", "#39ff6a", "#ffb000"],
  },
  {
    id: "playful",
    name: "Bubblegum",
    tagline: "Stickers, straws, confetti",
    fonts: "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap",
    swatch: ["#ff5fa2", "#ffd23f", "#3ec5ff"],
  },
  {
    id: "animals",
    name: "Field Guide",
    tagline: "Every repo has a critter",
    fonts:
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=Nunito:wght@400;600;700;800&display=swap",
    swatch: ["#2f5d3a", "#e9b949", "#f4eedf"],
  },
  {
    id: "weird",
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
