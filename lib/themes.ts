export const themes = [
  { id: 'light', label: 'Light', background: '#f7f9f8', dark: false },
  { id: 'dark', label: 'Dark', background: '#0b1115', dark: true },
] as const;

export type Theme = (typeof themes)[number]['id'];

export function isTheme(value: unknown): value is Theme {
  return themes.some(theme => theme.id === value);
}

export function restoreTheme(value: unknown): Theme | null {
  return isTheme(value) ? value : null;
}
