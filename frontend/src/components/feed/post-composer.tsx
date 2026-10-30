'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';

import { Field, fieldMessageId } from '@/components/shared/field';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCreatePost } from '@/hooks/use-create-post';
import { errorMessageKey } from '@/lib/api';
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

function isVisibility(value: string): value is PostVisibility {
  return (POST_VISIBILITIES as readonly string[]).includes(value);
}

/**
 * Publish a post from the top of the feed.
 *
 * `POST /api/v1/posts` is the only write F8 adds, and it answers with the
 * created `PostView` — but the card is NOT inserted optimistically: the feed is
 * a hybrid fan-out where the server decides rank (`docs/adr/003-hybrid-feed-
 * fanout.md`), so an invented card would land in the wrong position and then
 * jump. The composer instead clears itself and lets `useCreatePost` invalidate
 * the feed, which is one request and always correct.
 *
 * Accessibility: the textarea owns its error via `aria-describedby`, the
 * character counter is a plain `id` target (not a live region — announcing
 * every keystroke is noise), and a successful publish is announced once through
 * a `role="status"` line because the toast lives outside this subtree.
 *
 * (পোস্ট সফল হলে toast আর status — দুটোই, কারণ screen reader toast সবসময় ধরে না।)
 */
export function PostComposer() {
  const t = useTranslations('feed');
  const tValidation = useTranslations('feed.composer.validation');
  const tRoot = useTranslations();

  const [values, setValues] = useState<PostValues>(DEFAULT_POST_VALUES);
  const [errors, setErrors] = useState<FieldErrors<PostValues>>({});
  const [announcement, setAnnouncement] = useState('');

  const create = useCreatePost();
  const pending = create.isPending;
  const remaining = POST_BODY_MAX_LENGTH - values.body.length;

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = postSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(toFieldErrors<PostValues>(parsed.error));
      return;
    }

    setErrors({});
    setAnnouncement('');

    create.mutate(parsed.data, {
      onSuccess: () => {
        setValues(DEFAULT_POST_VALUES);
        setAnnouncement(t('composer.success'));
        toast.success(t('composer.success'));
      },
    });
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

      <div className="flex flex-wrap items-center justify-between gap-3">
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

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </form>
  );
}
