export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "renegadebox-theme";

export function getTheme(): Theme {
  if (typeof localStorage === "undefined") return "system";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark" || saved === "system") {
    return saved;
  }
  return "system";
}

export function setTheme(theme: Theme) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, theme);
  }
  applyTheme(theme);
}

export function applyTheme(theme?: Theme) {
  const t = theme ?? getTheme();
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (t === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", t);
  }
}
