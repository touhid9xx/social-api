'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

const ORDER = ['light', 'dark', 'system'] as const;

type ThemeChoice = (typeof ORDER)[number];

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * Cycles light -> dark -> system. Server-rendered markup must not depend on the
 * resolved theme, so the label renders only after mount (hydration safety).
 *
 * (mounted guard ছাড়া server আর client আলাদা icon রেন্ডার করে hydration error
 *  দেয়।)
 */
export function ThemeToggle() {
  const t = useTranslations('common');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const active: ThemeChoice = mounted && isThemeChoice(theme) ? theme : 'system';
  const Icon = ICONS[active];

  const label =
    active === 'light' ? t('themeLight') : active === 'dark' ? t('themeDark') : t('themeSystem');

  function cycle() {
    const next = ORDER[(ORDER.indexOf(active) + 1) % ORDER.length];
    if (next) {
      setTheme(next);
    }
  }

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`${t('theme')}: ${label}`}
      title={`${t('theme')}: ${label}`}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground shadow-xs transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system';
}
