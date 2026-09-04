export type Theme = "dark" | "light";

export const THEME_KEY = "ohmg:theme";

const META_LIGHT = "#F4F8FF";
const META_DARK = "#04070E";

function currentDocumentTheme(): Theme {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") return attr;
  }
  return "dark";
}

export function initTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    /* storage unavailable */
  }
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return currentDocumentTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? META_LIGHT : META_DARK);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable: theme still applies to this session */
  }
}
