import { getTranslations } from 'next-intl/server';

import { Placeholder } from '@/components/shared/placeholder';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const t = await getTranslations('pages.postDetail');
  const c = await getTranslations('common');

  return (
    <Placeholder
      badge={c('milestoneBadge')}
      title={t('title')}
      description={t('description', { id })}
      backLabel={c('backToHome')}
    />
  );
}
