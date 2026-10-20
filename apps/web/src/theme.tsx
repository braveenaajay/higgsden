import { useEffect, useState } from 'react';

const KEY = 'higgsden-theme';

export type ThemeName = 'light' | 'dark';

function readTheme(): ThemeName {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode */
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeName>(readTheme);

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  const next: ThemeName = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Switch to dark mode' : 'Switch to light mode';

  return (
    <button
      type="button"
      className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-2xl px-3 text-[15px] font-semibold text-ink ring-1 ring-line"
      aria-pressed={theme === 'dark'}
      aria-label={label}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
    >
      {next === 'dark' ? 'Dark' : 'Light'}
    </button>
  );
}
