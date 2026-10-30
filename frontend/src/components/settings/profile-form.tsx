'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';

import { Field, fieldMessageId } from '@/components/shared/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useMe } from '@/hooks/use-me';
import { useUpdateProfile } from '@/hooks/use-update-profile';
import { errorMessageKey, isAppApiError } from '@/lib/api';
import type { SelfProfile } from '@/lib/api/users';
import { type FieldErrors, toFieldErrors } from '@/lib/validation/auth';
import {
  ADDRESS_MAX_LENGTH,
  BIO_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  LOCATION_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  PROFILE_VISIBILITIES,
  type ProfileValues,
  type ProfileVisibility,
  profileSchema,
  toProfileUpdate,
  toProfileValues,
} from '@/lib/validation/profile';

const DISPLAY_NAME_ID = 'settings-display-name';
const BIO_ID = 'settings-bio';
const LOCATION_ID = 'settings-location';
const WEBSITE_ID = 'settings-website';
const PHONE_ID = 'settings-phone';
const ADDRESS_ID = 'settings-address';
const DOB_ID = 'settings-dob';
const VISIBILITY_ID = 'settings-visibility';
const PII_VISIBILITY_ID = 'settings-pii-visibility';

/** The long inline class string `post-composer.tsx` uses — there is no Select primitive. */
const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30';

function isVisibility(value: string): value is ProfileVisibility {
  return (PROFILE_VISIBILITIES as readonly string[]).includes(value);
}

/**
 * Settings → Profile: edit the caller's own profile.
 *
 * `PATCH /users/me` is optimistic-locked on `version`, so this screen is built
 * around one rule: **the form state is seeded once from the profile that was
 * read, and the version it was read at is what gets sent.** That is why the
 * fields live in a child component keyed off a resolved `useMe()` — a `useState`
 * initialiser cannot wait for an async value, and syncing with an effect would
 * overwrite whatever the user had already typed when the query settled.
 *
 * A 409 `VERSION_CONFLICT` is the one error with a mechanical fix, so it renders
 * a reload control that refetches `users/me` instead of leaving the user to
 * guess: their typing is not lost (only the lock is stale), but nothing will
 * save until the form holds the current version.
 */
export function ProfileForm() {
  const t = useTranslations('settings.profile');
  const me = useMe();

  if (me.isPending) {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-4">
        <span className="sr-only">{t('loading')}</span>
        {['a', 'b', 'c'].map((row) => (
          <div key={row} className="space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (me.isError || !me.data) {
    return (
      <div role="alert" className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium text-foreground">{t('errorTitle')}</p>
        <Button variant="outline" size="sm" onClick={() => void me.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return <ProfileFields profile={me.data} onReload={() => void me.refetch()} />;
}

function ProfileFields({ profile, onReload }: { profile: SelfProfile; onReload: () => void }) {
  const t = useTranslations('settings.profile');
  const tValidation = useTranslations('settings.validation');
  const tRoot = useTranslations();

  const [values, setValues] = useState<ProfileValues>(() => toProfileValues(profile));
  const [errors, setErrors] = useState<FieldErrors<ProfileValues>>({});

  const save = useUpdateProfile();
  const pending = save.isPending;
  const conflict = isAppApiError(save.error) && save.error.status === 409;

  function update(field: keyof ProfileValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = profileSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(toFieldErrors<ProfileValues>(parsed.error));
      return;
    }

    setErrors({});
    save.mutate(toProfileUpdate(parsed.data, profile), {
      onSuccess: () => {
        toast.success(t('saved'));
      },
    });
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5">
      {save.isError ? (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
        >
          <p className="text-sm text-destructive">{tRoot(errorMessageKey(save.error))}</p>
          {conflict ? (
            <Button type="button" variant="outline" size="sm" onClick={onReload}>
              {t('reload')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Field
        label={t('displayName')}
        htmlFor={DISPLAY_NAME_ID}
        help={t('displayNameHelp')}
        error={errors.display_name ? tValidation(errors.display_name) : undefined}
      >
        <Input
          id={DISPLAY_NAME_ID}
          name="display_name"
          autoComplete="name"
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          value={values.display_name}
          onChange={(event) => update('display_name', event.target.value)}
          aria-invalid={Boolean(errors.display_name) || undefined}
          aria-describedby={fieldMessageId(DISPLAY_NAME_ID)}
          disabled={pending}
        />
      </Field>

      <Field
        label={t('bio')}
        htmlFor={BIO_ID}
        help={t('bioHelp')}
        error={errors.bio ? tValidation(errors.bio) : undefined}
      >
        <Textarea
          id={BIO_ID}
          name="bio"
          rows={4}
          maxLength={BIO_MAX_LENGTH}
          value={values.bio}
          onChange={(event) => update('bio', event.target.value)}
          aria-invalid={Boolean(errors.bio) || undefined}
          aria-describedby={fieldMessageId(BIO_ID)}
          disabled={pending}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label={t('location')}
          htmlFor={LOCATION_ID}
          error={errors.location ? tValidation(errors.location) : undefined}
        >
          <Input
            id={LOCATION_ID}
            name="location"
            autoComplete="address-level2"
            maxLength={LOCATION_MAX_LENGTH}
            value={values.location}
            onChange={(event) => update('location', event.target.value)}
            aria-invalid={Boolean(errors.location) || undefined}
            aria-describedby={errors.location ? fieldMessageId(LOCATION_ID) : undefined}
            disabled={pending}
          />
        </Field>

        <Field
          label={t('website')}
          htmlFor={WEBSITE_ID}
          help={t('websiteHelp')}
          error={errors.website ? tValidation(errors.website) : undefined}
        >
          <Input
            id={WEBSITE_ID}
            name="website"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://example.com"
            value={values.website}
            onChange={(event) => update('website', event.target.value)}
            aria-invalid={Boolean(errors.website) || undefined}
            aria-describedby={fieldMessageId(WEBSITE_ID)}
            disabled={pending}
          />
        </Field>

        <Field
          label={t('phone')}
          htmlFor={PHONE_ID}
          error={errors.phone ? tValidation(errors.phone) : undefined}
        >
          <Input
            id={PHONE_ID}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={PHONE_MAX_LENGTH}
            value={values.phone}
            onChange={(event) => update('phone', event.target.value)}
            aria-invalid={Boolean(errors.phone) || undefined}
            aria-describedby={errors.phone ? fieldMessageId(PHONE_ID) : undefined}
            disabled={pending}
          />
        </Field>

        <Field
          label={t('dob')}
          htmlFor={DOB_ID}
          help={t('dobHelp')}
          error={errors.dob ? tValidation(errors.dob) : undefined}
        >
          <Input
            id={DOB_ID}
            name="dob"
            type="date"
            value={values.dob}
            onChange={(event) => update('dob', event.target.value)}
            aria-invalid={Boolean(errors.dob) || undefined}
            aria-describedby={fieldMessageId(DOB_ID)}
            disabled={pending}
          />
        </Field>
      </div>

      <Field
        label={t('address')}
        htmlFor={ADDRESS_ID}
        help={t('addressHelp')}
        error={errors.address ? tValidation(errors.address) : undefined}
      >
        <Textarea
          id={ADDRESS_ID}
          name="address"
          rows={2}
          maxLength={ADDRESS_MAX_LENGTH}
          value={values.address}
          onChange={(event) => update('address', event.target.value)}
          aria-invalid={Boolean(errors.address) || undefined}
          aria-describedby={fieldMessageId(ADDRESS_ID)}
          disabled={pending}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor={VISIBILITY_ID} className="text-sm leading-none font-medium">
            {t('visibility')}
          </label>
          <select
            id={VISIBILITY_ID}
            name="visibility"
            value={values.visibility}
            onChange={(event) => {
              if (isVisibility(event.target.value)) update('visibility', event.target.value);
            }}
            aria-describedby={fieldMessageId(VISIBILITY_ID)}
            disabled={pending}
            className={SELECT_CLASS}
          >
            {PROFILE_VISIBILITIES.map((visibility) => (
              <option key={visibility} value={visibility}>
                {t(`visibilityOptions.${visibility}`)}
              </option>
            ))}
          </select>
          <p id={fieldMessageId(VISIBILITY_ID)} className="text-micro text-muted-foreground">
            {t('visibilityHelp')}
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor={PII_VISIBILITY_ID} className="text-sm leading-none font-medium">
            {t('piiVisibility')}
          </label>
          <select
            id={PII_VISIBILITY_ID}
            name="pii_visibility"
            value={values.pii_visibility}
            onChange={(event) => {
              if (isVisibility(event.target.value)) update('pii_visibility', event.target.value);
            }}
            aria-describedby={fieldMessageId(PII_VISIBILITY_ID)}
            disabled={pending}
            className={SELECT_CLASS}
          >
            {PROFILE_VISIBILITIES.map((visibility) => (
              <option key={visibility} value={visibility}>
                {t(`visibilityOptions.${visibility}`)}
              </option>
            ))}
          </select>
          <p id={fieldMessageId(PII_VISIBILITY_ID)} className="text-micro text-muted-foreground">
            {t('piiVisibilityHelp')}
          </p>
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {pending ? t('saving') : t('save')}
      </Button>
    </form>
  );
}
