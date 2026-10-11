import { useEffect, useState } from "react";

import { parseThemePreference, usesDarkTheme, type ThemePreference } from "./theme-policy";
export type { ThemePreference } from "./theme-policy";
const KEY = "oscar-next-appearance";

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(KEY);
    return parseThemePreference(stored);
  } catch { return "dark"; }
}

export function applyTheme(preference: ThemePreference): void {
  const dark = usesDarkTheme(preference, window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  window.dispatchEvent(new Event("oscar-theme-change"));
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemePreference>(readThemePreference);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyTheme(theme);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  const setTheme = (next: ThemePreference) => {
    try { localStorage.setItem(KEY, next); } catch { /* Appearance works without storage. */ }
    setThemeState(next);
  };
  return { theme, setTheme };
}

applyTheme(readThemePreference());
