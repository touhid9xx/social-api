'use client';

import { Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useSetAvatar } from '@/hooks/use-set-avatar';
import { errorMessageKey } from '@/lib/api';
import { MEDIA_MAX_IMAGE_BYTES, mediaUrl } from '@/lib/api/media';

const AVATAR_INPUT_ID = 'settings-avatar';
const AVATAR_ERROR_ID = 'settings-avatar-error';

/**
 * Settings → Profile: upload a profile picture.
 *
 * Separate from the rest of the form on purpose. The form is a single
 * optimistic-locked `PATCH /users/me` that sends only changed fields at the
 * version it read; the avatar is a *different* write — `POST /media` (bytes)
 * then `POST /media/{id}/avatar` (promotion by id). Folding it into the submit
 * button would mean either uploading bytes on a form nobody asked to save, or
 * holding a `File` in form state across a version conflict that may never
 * resolve. It saves the moment a file is picked, and everything else stays
 * untouched.
 *
 * Client-side checks (type, size) mirror `MEDIA_MAX_IMAGE_BYTES` so an obviously
 * wrong file does not cost an upload; the backend re-validates by magic bytes,
 * so this is UX and not the security boundary.
 *
 * Accessibility: the file input is a real labelled `<input>` with the visible
 * button as its label, failures go to one `role="alert"` line wired via
 * `aria-describedby`, and success is announced through `role="status"` because
 * the toast lives outside this subtree.
 */
export function AvatarUpload({
  avatarUrl,
  displayName,
}: {
  /**
   * Mirrors `ProfileSelf['avatar_url']`, which is optional *and* nullable in the
   * generated contract — an unresolvable profile and a profile without a
   * picture are different states upstream, and this prop must accept both.
   */
  avatarUrl?: string | null;
  displayName: string;
}) {
  const t = useTranslations('settings.profile.avatar');
  const tRoot = useTranslations();
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');

  const setAvatar = useSetAvatar();
  const pending = setAvatar.isPending;
  const initial = displayName.trim().slice(0, 1).toUpperCase();

  function pick(file: File | undefined) {
    if (!file) return;
    setError('');
    setAnnouncement('');

    if (!file.type.startsWith('image/')) {
      setError(t('wrongType'));
      return;
    }

    if (file.size > MEDIA_MAX_IMAGE_BYTES) {
      setError(t('tooLarge', { megabytes: Math.round(MEDIA_MAX_IMAGE_BYTES / (1024 * 1024)) }));
      return;
    }

    setAvatar.mutate(file, {
      onSuccess: () => {
        setAnnouncement(t('success'));
        toast.success(t('success'));
      },
      onError: (cause) => {
        // The mutation error is also rendered below; the toast is for the case
        // where the user has already scrolled down to the bio field.
        toast.error(tRoot(errorMessageKey(cause)));
      },
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar size="lg">
        {avatarUrl ? <AvatarImage src={mediaUrl(avatarUrl)} alt="" /> : null}
        <AvatarFallback aria-hidden="true">{initial || '?'}</AvatarFallback>
      </Avatar>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t('label')}</p>
        <p className="text-micro text-muted-foreground">{t('help')}</p>

        <div className="flex items-center gap-2">
          <label
            htmlFor={AVATAR_INPUT_ID}
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 hover:bg-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:bg-input/30"
            aria-disabled={pending}
          >
            {pending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Upload aria-hidden="true" className="size-4" />
            )}
            {pending ? t('uploading') : t('action')}
          </label>
          <input
            id={AVATAR_INPUT_ID}
            name="avatar"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            disabled={pending}
            aria-describedby={error ? AVATAR_ERROR_ID : undefined}
            onChange={(event) => {
              pick(event.target.files?.[0]);
              // Reset so re-picking the same file still fires `change`.
              event.target.value = '';
            }}
          />
        </div>

        {error ? (
          <p id={AVATAR_ERROR_ID} role="alert" className="text-micro text-destructive">
            {error}
          </p>
        ) : setAvatar.isError ? (
          <p role="alert" className="text-micro text-destructive">
            {tRoot(errorMessageKey(setAvatar.error))}
          </p>
        ) : null}
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
