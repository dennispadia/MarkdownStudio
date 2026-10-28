export const themes = [
  { id: 'light', label: 'Light', background: '#f8faf8', dark: false },
  { id: 'dark', label: 'Dark', background: '#0d1117', dark: true },
] as const;

export type Theme = (typeof themes)[number]['id'];

export function isTheme(value: unknown): value is Theme {
  return themes.some(theme => theme.id === value);
}

export function restoreTheme(value: unknown): Theme | null {
  if (value === 'github-dark') return 'dark';
  return isTheme(value) ? value : null;
}
