import { getTranslations } from 'next-intl/server';

import { Placeholder } from '@/components/shared/placeholder';

export default async function Page() {
  const t = await getTranslations('pages.settings');
  const c = await getTranslations('common');

  return (
    <Placeholder
      badge={c('milestoneBadge')}
      title={t('title')}
      description={t('description')}
      backLabel={c('backToHome')}
    />
  );
}
