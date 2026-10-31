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
 * Theme mode picker — icon buttons only, no visible text.
 *
 * A cycling button was the previous shape, and it made the *current* mode the
 * only thing on screen: the other two were reachable but invisible, so choosing
 * "dark" from "light" meant guessing how many presses it took. Three always-
 * visible icon buttons make every mode one press away.
 *
 * With the words gone, the accessible name carries the whole meaning, so each
 * button is labelled `Theme: Light` / `Theme: Dark` / `Theme: System` and marked
 * with `aria-pressed`. The group itself is labelled so a screen reader announces
 * "Theme, group" before reading three identical-looking icon buttons.
 *
 * Server-rendered markup must not depend on the resolved theme: `useTheme()`
 * returns `undefined` on the server, so the pressed state renders only after
 * mount. Without the guard the server would emit a different `aria-pressed` than
 * the client and React would warn about a hydration mismatch.
 *
 * (থিম মোড এখন শুধু আইকন বাটন — লেখা নেই। তাই প্রতিটি বাটনের accessible name-ই
 *  একমাত্র অর্থ বহন করে, আর `aria-pressed` দিয়ে বর্তমান মোড বোঝা যায়।)
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('common');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const active: ThemeChoice = mounted && isThemeChoice(theme) ? theme : 'system';

  return (
    <div
      role="group"
      aria-label={t('theme')}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5',
        className,
      )}
    >
      {ORDER.map((choice) => {
        const Icon = ICONS[choice];
        const label =
          choice === 'light'
            ? t('themeLight')
            : choice === 'dark'
              ? t('themeDark')
              : t('themeSystem');

        return (
          <button
            key={choice}
            type="button"
            onClick={() => {
              setTheme(choice);
            }}
            aria-label={`${t('theme')}: ${label}`}
            aria-pressed={active === choice}
            title={`${t('theme')}: ${label}`}
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-[5px] transition-colors',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              active === choice
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
          </button>
        );
      })}
    </div>
  );
}

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system';
}
