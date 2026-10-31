'use client';

import { useTranslations } from 'next-intl';

import { ChangePasswordForm } from '@/components/settings/change-password-form';
import { ConsentPanel } from '@/components/settings/consent-panel';
import { DataPrivacyPanel } from '@/components/settings/data-privacy-panel';
import { ProfileForm } from '@/components/settings/profile-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TAB_VALUES = ['profile', 'consent', 'privacy', 'security'] as const;

type TabValue = (typeof TAB_VALUES)[number];

/**
 * The settings screen's four sections.
 *
 * A client component only because Radix tabs are: the page shell stays a server
 * component so the heading is translated before hydration. Each panel owns its
 * own query (`useMe`, `useConsents`, the deletion status) or mutation, so
 * switching tabs is the only thing that decides which of them gets fetched — the
 * profile tab does not block the privacy tab from rendering.
 */
export function SettingsTabs() {
  const t = useTranslations('settings');

  return (
    <Tabs defaultValue="profile" className="space-y-6">
      <TabsList>
        {TAB_VALUES.map((tab) => (
          <TabsTrigger key={tab} value={tab}>
            {t(`tabs.${tab}` as `tabs.${TabValue}`)}
          </TabsTrigger>
        ))}
      </TabsList>

      {TAB_VALUES.map((tab) => (
        <TabsContent key={tab} value={tab}>
          <Card>
            <CardHeader>
              <CardTitle>{t(`${tab}.title` as `${TabValue}.title`)}</CardTitle>
            </CardHeader>
            <CardContent>
              {tab === 'profile' ? <ProfileForm /> : null}
              {tab === 'consent' ? <ConsentPanel /> : null}
              {tab === 'privacy' ? <DataPrivacyPanel /> : null}
              {tab === 'security' ? <ChangePasswordForm /> : null}
            </CardContent>
          </Card>
        </TabsContent>
      ))}
    </Tabs>
  );
}
