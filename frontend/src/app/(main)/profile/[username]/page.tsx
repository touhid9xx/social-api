import { getTranslations } from 'next-intl/server';

import { Placeholder } from '@/components/shared/placeholder';

type PageProps = {
  params: Promise<{ username: string }>;
};

export default async function Page({ params }: PageProps) {
  const { username } = await params;
  const t = await getTranslations('pages.profile');
  const c = await getTranslations('common');

  return (
    <Placeholder
      badge={c('milestoneBadge')}
      title={t('title')}
      description={t('description', { username })}
      backLabel={c('backToHome')}
    />
  );
}
