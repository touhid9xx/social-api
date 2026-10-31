'use client';

import { ImagePlus, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Field, fieldMessageId } from '@/components/shared/field';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCreatePost } from '@/hooks/use-create-post';
import { errorMessageKey } from '@/lib/api';
import { MEDIA_MAX_IMAGE_BYTES, MEDIA_MAX_VIDEO_BYTES } from '@/lib/api/media';
import { type FieldErrors, toFieldErrors } from '@/lib/validation/auth';
import {
  DEFAULT_POST_VALUES,
  POST_BODY_MAX_LENGTH,
  POST_VISIBILITIES,
  type PostValues,
  type PostVisibility,
  postSchema,
} from '@/lib/validation/post';

const BODY_ID = 'composer-body';
const VISIBILITY_ID = 'composer-visibility';
const COUNTER_ID = 'composer-counter';
const MEDIA_INPUT_ID = 'composer-media';
const MEDIA_ERROR_ID = 'composer-media-error';

/** Attachments per post. The backend has no cap (`media.post_id` is many-to-one),
 *  so this is a UI decision: a feed card grid stops being readable past four. */
const MAX_ATTACHMENTS = 4;

type Attachment = {
  file: File;
  /** Object URL for image previews; `null` for video, which we do not decode. */
  preview: string | null;
};

function limitFor(file: File): number {
  return file.type.startsWith('video/') ? MEDIA_MAX_VIDEO_BYTES : MEDIA_MAX_IMAGE_BYTES;
}

function isVisibility(value: string): value is PostVisibility {
  return (POST_VISIBILITIES as readonly string[]).includes(value);
}

/**
 * Publish a post from the top of the feed, with optional media.
 *
 * `POST /api/v1/posts` is the only write F8 adds, and it answers with the
 * created `PostView` — but the card is NOT inserted optimistically: the feed is
 * a hybrid fan-out where the server decides rank (`docs/adr/003-hybrid-feed-
 * fanout.md`), so an invented card would land in the wrong position and then
 * jump. The composer instead clears itself and lets `useCreatePost` invalidate
 * the feed, which is one request and always correct.
 *
 * Media needs two more requests per file (`POST /media`, then
 * `POST /media/{id}/attach/{post_id}`) because `PostCreate` is
 * `extra="forbid"`: the post must exist before a file can be attached to it.
 * `useCreatePost` owns that sequence; this component only picks and previews
 * the files, refusing anything the backend would reject for size.
 *
 * Accessibility: the textarea owns its error via `aria-describedby`, the
 * character counter is a plain `id` target (not a live region — announcing
 * every keystroke is noise), the file input is a real labelled `<input>` (not a
 * styled div), each thumbnail's remove button names the file it removes, and a
 * successful publish is announced once through a `role="status"` line because
 * the toast lives outside this subtree.
 *
 * (পোস্ট সফল হলে toast আর status — দুটোই, কারণ screen reader toast সবসময় ধরে না।)
 */
export function PostComposer() {
  const t = useTranslations('feed');
  const tValidation = useTranslations('feed.composer.validation');
  const tRoot = useTranslations();

  const [values, setValues] = useState<PostValues>(DEFAULT_POST_VALUES);
  const [errors, setErrors] = useState<FieldErrors<PostValues>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mediaError, setMediaError] = useState('');
  const [announcement, setAnnouncement] = useState('');

  const create = useCreatePost();
  const pending = create.isPending;
  const remaining = POST_BODY_MAX_LENGTH - values.body.length;

  // Object URLs outlive the render that made them, so they are revoked on
  // unmount from a ref rather than from the state updater.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(
    () => () => {
      for (const attachment of attachmentsRef.current) {
        if (attachment.preview) URL.revokeObjectURL(attachment.preview);
      }
    },
    [],
  );

  function updateBody(value: string) {
    setValues((current) => ({ ...current, body: value }));
    setErrors((current) => (current.body ? { ...current, body: undefined } : current));
  }

  function updateVisibility(value: string) {
    // `PostCreate.visibility` is a Literal on the server; an unexpected option
    // value must not reach the request body.
    if (!isVisibility(value)) return;
    setValues((current) => ({ ...current, visibility: value }));
    setErrors((current) => (current.visibility ? { ...current, visibility: undefined } : current));
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setMediaError('');

    const accepted: Attachment[] = [];
    for (const file of Array.from(list)) {
      if (attachments.length + accepted.length >= MAX_ATTACHMENTS) {
        setMediaError(t('composer.tooManyFiles', { max: MAX_ATTACHMENTS }));
        break;
      }
      if (file.size > limitFor(file)) {
        setMediaError(t('composer.fileTooLarge', { name: file.name }));
        continue;
      }
      accepted.push({
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    }

    if (accepted.length > 0) setAttachments((current) => [...current, ...accepted]);
  }

  function removeFile(index: number) {
    const target = attachments[index];
    if (target?.preview) URL.revokeObjectURL(target.preview);
    setAttachments((current) => current.filter((_, position) => position !== index));
    setMediaError('');
  }

  function clearAttachments() {
    for (const attachment of attachments) {
      if (attachment.preview) URL.revokeObjectURL(attachment.preview);
    }
    setAttachments([]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = postSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(toFieldErrors<PostValues>(parsed.error));
      return;
    }

    setErrors({});
    setAnnouncement('');

    const files = attachments.map((attachment) => attachment.file);

    create.mutate(
      { values: parsed.data, files },
      {
        onSuccess: () => {
          clearAttachments();
          setValues(DEFAULT_POST_VALUES);
          setAnnouncement(t('composer.success'));
          toast.success(t('composer.success'));
        },
      },
    );
  }

  const submitLabel = pending ? t('composer.submitting') : t('composer.submit');

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-label={t('composer.title')}
      className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      {create.isError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {tRoot(errorMessageKey(create.error))}
        </p>
      ) : null}

      {/* The form already carries `composer.title` as its landmark name; the
          field needs a name of its own, or the same string labels two different
          nodes. */}
      <Field
        label={t('composer.bodyLabel')}
        htmlFor={BODY_ID}
        error={errors.body && tValidation(errors.body, { max: POST_BODY_MAX_LENGTH })}
      >
        <Textarea
          id={BODY_ID}
          name="body"
          rows={3}
          required
          maxLength={POST_BODY_MAX_LENGTH}
          placeholder={t('composer.placeholder')}
          value={values.body}
          onChange={(event) => updateBody(event.target.value)}
          aria-invalid={Boolean(errors.body) || undefined}
          aria-describedby={errors.body ? fieldMessageId(BODY_ID) : COUNTER_ID}
          disabled={pending}
        />
      </Field>

      {attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('composer.attachmentsLabel')}>
          {attachments.map((attachment, index) => (
            <li key={`${attachment.file.name}-${String(index)}`} className="relative">
              {attachment.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- object URL, not an optimizable remote asset
                <img
                  src={attachment.preview}
                  alt={attachment.file.name}
                  className="size-20 rounded-md border border-border object-cover"
                />
              ) : (
                <span className="flex size-20 items-center justify-center rounded-md border border-border bg-muted text-micro text-muted-foreground">
                  {t('composer.videoPreview')}
                </span>
              )}

              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                className="absolute -top-2 -right-2 rounded-full"
                onClick={() => removeFile(index)}
                disabled={pending}
                aria-label={t('composer.removeAttachment', { name: attachment.file.name })}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* A bare file input is focusable and labelled; the visible Button is
              its label, so no JS-only click target is introduced. */}
          <label
            htmlFor={MEDIA_INPUT_ID}
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 hover:bg-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:bg-input/30"
            aria-disabled={pending}
          >
            <ImagePlus aria-hidden="true" className="size-4" />
            {t('composer.addMedia')}
          </label>
          <input
            id={MEDIA_INPUT_ID}
            name="media"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
            className="sr-only"
            onChange={(event) => {
              addFiles(event.target.files);
              // Reset so re-picking the same file still fires `change`.
              event.target.value = '';
            }}
            disabled={pending}
            aria-describedby={mediaError ? MEDIA_ERROR_ID : undefined}
          />

          <label htmlFor={VISIBILITY_ID} className="sr-only">
            {t('composer.visibility')}
          </label>
          <select
            id={VISIBILITY_ID}
            name="visibility"
            value={values.visibility}
            onChange={(event) => updateVisibility(event.target.value)}
            disabled={pending}
            aria-invalid={Boolean(errors.visibility) || undefined}
            aria-describedby={errors.visibility ? fieldMessageId(VISIBILITY_ID) : undefined}
            className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30"
          >
            {POST_VISIBILITIES.map((visibility) => (
              <option key={visibility} value={visibility}>
                {t(`visibility.${visibility}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span id={COUNTER_ID} className="text-micro text-muted-foreground tabular-nums">
            {t('composer.counter', { count: remaining })}
          </span>

          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {submitLabel}
          </Button>
        </div>
      </div>

      {/* Visibility errors have no Field wrapper of their own, so the message is
          rendered here and the select points at it. */}
      {errors.visibility ? (
        <p id={fieldMessageId(VISIBILITY_ID)} className="text-micro text-destructive">
          {tValidation(errors.visibility)}
        </p>
      ) : null}

      {mediaError ? (
        <p id={MEDIA_ERROR_ID} role="alert" className="text-micro text-destructive">
          {mediaError}
        </p>
      ) : null}

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </form>
  );
}
