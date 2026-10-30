'use client';

import { Bell, Heart, Mail, MoreHorizontal, Plus, Settings, Share2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

import { Field } from '@/components/shared/field';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type Swatch = { token: string; className: string };

const SURFACES: Swatch[] = [
  { token: 'background', className: 'bg-background' },
  { token: 'foreground', className: 'bg-foreground' },
  { token: 'card', className: 'bg-card' },
  { token: 'popover', className: 'bg-popover' },
  { token: 'secondary', className: 'bg-secondary' },
  { token: 'muted', className: 'bg-muted' },
  { token: 'accent', className: 'bg-accent' },
  { token: 'sidebar', className: 'bg-sidebar' },
  { token: 'border', className: 'bg-border' },
  { token: 'input', className: 'bg-input' },
];

const BRAND: Swatch[] = [
  { token: 'primary', className: 'bg-primary' },
  { token: 'primary-foreground', className: 'bg-primary-foreground' },
  { token: 'destructive', className: 'bg-destructive' },
  { token: 'success', className: 'bg-success' },
  { token: 'warning', className: 'bg-warning' },
  { token: 'info', className: 'bg-info' },
  { token: 'ring', className: 'bg-ring' },
];

const CHARTS: Swatch[] = [
  { token: 'chart-1', className: 'bg-chart-1' },
  { token: 'chart-2', className: 'bg-chart-2' },
  { token: 'chart-3', className: 'bg-chart-3' },
  { token: 'chart-4', className: 'bg-chart-4' },
  { token: 'chart-5', className: 'bg-chart-5' },
];

const AVATAR_SRC =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%236366f1'/><stop offset='1' stop-color='%2314b8a6'/></linearGradient></defs><rect width='40' height='40' fill='url(%23g)'/></svg>";

export default function DesignSystemPage() {
  const t = useTranslations('designSystem');

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-micro font-medium tracking-wide text-muted-foreground uppercase">F2</p>
          <h1 className="mt-1 text-h1 text-foreground">{t('title')}</h1>
          <p className="mt-2 max-w-2xl text-small text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="outline" size="sm">
            <Link href="/">{t('backHome')}</Link>
          </Button>
        </div>
      </header>

      <div className="mt-12 space-y-12">
        {/* ---------------------------------------------------- typography -- */}
        <Section title={t('sections.typography')}>
          <div className="space-y-3 rounded-lg border border-border bg-card p-6">
            <p className="text-display text-foreground">{t('typography.display')}</p>
            <p className="text-h1 text-foreground">{t('typography.h1')}</p>
            <p className="text-h2 text-foreground">{t('typography.h2')}</p>
            <p className="text-h3 text-foreground">{t('typography.h3')}</p>
            <p className="text-body text-muted-foreground">{t('typography.body')}</p>
            <p className="text-small text-muted-foreground">{t('typography.small')}</p>
            <p className="text-micro text-muted-foreground uppercase">{t('typography.micro')}</p>
            <p className="overflow-x-auto font-mono text-small text-foreground">
              {t('typography.mono')}
            </p>
            <p className="border-t border-border pt-3 text-micro text-muted-foreground">
              {t('typography.note')}
            </p>
          </div>
        </Section>

        {/* -------------------------------------------------------- colors -- */}
        <Section title={t('sections.colors')}>
          <div className="space-y-5">
            <SwatchGrid title={t('colors.surfaces')} items={SURFACES} />
            <SwatchGrid title={t('colors.brand')} items={BRAND} />
            <SwatchGrid title={t('colors.charts')} items={CHARTS} />
          </div>
        </Section>

        {/* ------------------------------------------------------- buttons -- */}
        <Section title={t('sections.buttons')}>
          <div className="space-y-6 rounded-lg border border-border bg-card p-6">
            <Row label={t('buttons.variants')}>
              <Button>{t('buttons.default')}</Button>
              <Button variant="secondary">{t('buttons.secondary')}</Button>
              <Button variant="destructive">{t('buttons.destructive')}</Button>
              <Button variant="outline">{t('buttons.outline')}</Button>
              <Button variant="ghost">{t('buttons.ghost')}</Button>
              <Button variant="link">{t('buttons.link')}</Button>
            </Row>

            <Row label={t('buttons.sizes')}>
              <Button size="sm">{t('buttons.sm')}</Button>
              <Button size="default">{t('buttons.md')}</Button>
              <Button size="lg">{t('buttons.lg')}</Button>
              <Button size="icon" aria-label={t('sections.buttons')}>
                <Plus aria-hidden="true" />
              </Button>
              <Button size="icon-sm" variant="outline" aria-label={t('sections.buttons')}>
                <Heart aria-hidden="true" />
              </Button>
            </Row>

            <Row label={t('buttons.states')}>
              <Button disabled>{t('buttons.disabled')}</Button>
              <Button>
                <Plus aria-hidden="true" />
                {t('buttons.withIcon')}
              </Button>
              <Button variant="secondary">{t('buttons.follow')}</Button>
              <Button asChild variant="outline">
                <Link href="/home">{t('buttons.asChild')}</Link>
              </Button>
              <Button variant="outline" aria-invalid>
                {t('buttons.save')}
              </Button>
            </Row>
          </div>
        </Section>

        {/* -------------------------------------------------------- badges -- */}
        <Section title={t('sections.badges')}>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-6">
            <Badge>{t('badges.default')}</Badge>
            <Badge variant="secondary">{t('badges.secondary')}</Badge>
            <Badge variant="outline">{t('badges.outline')}</Badge>
            <Badge variant="destructive">{t('badges.destructive')}</Badge>
            <Badge className="bg-success text-success-foreground">{t('badges.success')}</Badge>
            <Badge className="bg-warning text-warning-foreground">{t('badges.new')}</Badge>
            <Badge className="bg-info text-info-foreground">{t('badges.new')}</Badge>
          </div>
        </Section>

        {/* --------------------------------------------------------- forms -- */}
        <Section title={t('sections.forms')}>
          <div className="grid gap-5 rounded-lg border border-border bg-card p-6 sm:grid-cols-2">
            <Field label={t('forms.name')} htmlFor="ds-name" help={t('forms.help')}>
              <Input id="ds-name" placeholder={t('forms.namePlaceholder')} />
            </Field>

            <Field label={t('forms.email')} htmlFor="ds-email">
              <div className="relative">
                <Mail
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="ds-email"
                  type="email"
                  className="pl-9"
                  placeholder={t('forms.emailPlaceholder')}
                />
              </div>
            </Field>

            <Field
              label={t('forms.invalidLabel')}
              htmlFor="ds-invalid"
              help={t('forms.invalidHelp')}
              invalid
            >
              <Input id="ds-invalid" aria-invalid defaultValue={t('forms.invalidEmail')} />
            </Field>

            <Field label={t('forms.disabledLabel')} htmlFor="ds-disabled">
              <Input id="ds-disabled" disabled defaultValue={t('forms.disabledValue')} />
            </Field>

            <div className="sm:col-span-2">
              <Field label={t('forms.bio')} htmlFor="ds-bio">
                <Textarea id="ds-bio" rows={3} placeholder={t('forms.bioPlaceholder')} />
              </Field>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- card -- */}
        <Section title={t('sections.card')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('card.title')}</CardTitle>
                <CardDescription>{t('card.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-small text-muted-foreground">{t('card.body')}</p>
              </CardContent>
              <CardFooter className="justify-between">
                <span className="text-micro text-muted-foreground">{t('card.footer')}</span>
                <Button size="sm" variant="outline">
                  {t('card.action')}
                </Button>
              </CardFooter>
            </Card>

            <div className="space-y-3 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src={AVATAR_SRC} alt="" />
                  <AvatarFallback>{t('avatar.fallback')}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-small font-medium text-foreground">
                    {t('avatar.alt')}
                  </p>
                  <p className="text-micro text-muted-foreground">{t('card.footer')}</p>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={t('dropdown.trigger')}>
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </div>
              <p className="text-small text-foreground">{t('card.body')}</p>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost">
                  <Heart aria-hidden="true" />
                  128
                </Button>
                <Button size="sm" variant="ghost">
                  <Share2 aria-hidden="true" />
                  24
                </Button>
              </div>
            </div>
          </div>
        </Section>

        {/* -------------------------------------------------------- avatar -- */}
        <Section title={t('sections.avatar')}>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card p-6">
            <Avatar className="size-6">
              <AvatarImage src={AVATAR_SRC} alt="" />
              <AvatarFallback>{t('avatar.fallback')}</AvatarFallback>
            </Avatar>
            <Avatar className="size-8">
              <AvatarImage src={AVATAR_SRC} alt="" />
              <AvatarFallback>{t('avatar.fallback')}</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarImage src={AVATAR_SRC} alt={t('avatar.alt')} />
              <AvatarFallback>{t('avatar.fallback')}</AvatarFallback>
            </Avatar>
            <Avatar className="size-14">
              <AvatarFallback>{t('avatar.fallback')}</AvatarFallback>
            </Avatar>
            <Avatar className="size-14">
              <AvatarFallback>
                <UserRound aria-hidden="true" />
              </AvatarFallback>
            </Avatar>
            <p className="text-small text-muted-foreground">{t('avatar.sizes')}</p>
          </div>
        </Section>

        {/* ---------------------------------------------------------- tabs -- */}
        <Section title={t('sections.tabs')}>
          <Tabs defaultValue="overview" className="rounded-lg border border-border bg-card p-6">
            <TabsList>
              <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
              <TabsTrigger value="activity">{t('tabs.activity')}</TabsTrigger>
              <TabsTrigger value="settings">{t('tabs.settings')}</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <p className="text-small text-muted-foreground">{t('tabs.overviewBody')}</p>
            </TabsContent>
            <TabsContent value="activity">
              <p className="text-small text-muted-foreground">{t('tabs.activityBody')}</p>
            </TabsContent>
            <TabsContent value="settings">
              <p className="text-small text-muted-foreground">{t('tabs.settingsBody')}</p>
            </TabsContent>
          </Tabs>
        </Section>

        {/* ------------------------------------------------------ skeleton -- */}
        <Section title={t('sections.skeleton')}>
          <div className="space-y-3 rounded-lg border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-40 w-full rounded-md" />
            <p className="text-micro text-muted-foreground">{t('skeleton.note')}</p>
          </div>
        </Section>

        {/* -------------------------------------------------------- dialog -- */}
        <Section title={t('sections.dialog')}>
          <div className="rounded-lg border border-border bg-card p-6">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive">{t('dialog.trigger')}</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('dialog.title')}</DialogTitle>
                  <DialogDescription>{t('dialog.description')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{t('dialog.cancel')}</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="destructive">{t('dialog.confirm')}</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </Section>

        {/* ------------------------------------------------------ dropdown -- */}
        <Section title={t('sections.dropdown')}>
          <div className="rounded-lg border border-border bg-card p-6">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Settings aria-hidden="true" />
                  {t('dropdown.trigger')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuLabel>{t('dropdown.label')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <UserRound aria-hidden="true" />
                  {t('dropdown.profile')}
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings aria-hidden="true" />
                  {t('dropdown.settings')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  <Bell aria-hidden="true" />
                  {t('dropdown.danger')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Section>

        {/* -------------------------------------------------------- toasts -- */}
        <Section title={t('sections.toasts')}>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-6">
            <Button size="sm" onClick={() => toast.success(t('toasts.success'))}>
              {t('buttons.save')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => toast.info(t('toasts.info'))}>
              {t('toasts.trigger')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => toast.warning(t('toasts.warning'))}>
              {t('buttons.follow')}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => toast.error(t('toasts.error'))}>
              {t('buttons.destructive')}
            </Button>
            <p className="w-full text-micro text-muted-foreground">{t('toasts.note')}</p>
          </div>
        </Section>
      </div>
    </div>
  );
}

function SwatchGrid({ title, items }: { title: string; items: Swatch[] }) {
  return (
    <div>
      <p className="text-micro font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        {items.map((item) => (
          <div key={item.token} className="overflow-hidden rounded-md border border-border">
            <div className={cn('h-12 w-full', item.className)} />
            <p className="truncate bg-card px-2 py-1 font-mono text-micro text-muted-foreground">
              {item.token}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="scroll-mt-20">
      <h2 className="text-h2 text-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-micro font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
