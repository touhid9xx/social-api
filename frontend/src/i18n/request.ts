import type { AbstractIntlMessages } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from './config';

type Catalog = { default: AbstractIntlMessages };

const catalogs: Record<Locale, () => Promise<Catalog>> = {
  en: () => import('../../messages/en.json') as Promise<Catalog>,
  bn: () => import('../../messages/bn.json') as Promise<Catalog>,
};

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value ?? '';
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale;

  const messages = (await catalogs[locale]()).default;

  return { locale, messages };
});
