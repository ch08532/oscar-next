export type ThemePreference = "dark" | "light" | "system";

export function parseThemePreference(stored: string | null): ThemePreference {
  return stored === "light" || stored === "system" ? stored : "dark";
}

export function usesDarkTheme(preference: ThemePreference, systemDark: boolean): boolean {
  return preference === "dark" || (preference === "system" && systemDark);
}
