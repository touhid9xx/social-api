'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';
import { toast } from 'sonner';

import { Field, fieldMessageId } from '@/components/shared/field';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCreateComment } from '@/hooks/use-create-comment';
import { errorMessageKey } from '@/lib/api';
import { type FieldErrors, toFieldErrors } from '@/lib/validation/auth';
import {
  COMMENT_BODY_MAX_LENGTH,
  type CommentValues,
  DEFAULT_COMMENT_VALUES,
  commentSchema,
} from '@/lib/validation/comment';

/**
 * The one comment form: a new comment when `parentId` is null, a reply when it
 * is not.
 *
 * Replies belong to the same component because the request is the same request —
 * `CommentCreate` carries `parent_id` and nothing else changes. Only the labels
 * differ, so the two forms cannot drift apart in validation or accessibility.
 *
 * Accessibility: the textarea owns its error through `aria-describedby`, the
 * counter is a plain id target (not a live region — announcing every keystroke
 * is noise), and a successful post is announced once through `role="status"`
 * because the toast lives outside this subtree.
 */
export function CommentForm({
  postId,
  parentId = null,
  replyingTo,
  onDone,
  autoFocus = false,
}: {
  postId: number;
  /** `null` comments on the post; an id replies to that top-level comment. */
  parentId?: number | null;
  /** Display name of the author being replied to, for the form's own name. */
  replyingTo?: string;
  /** Called after a successful submit — a reply form closes itself. */
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const t = useTranslations('feed.comments');
  const tValidation = useTranslations('feed.comments.validation');
  const tRoot = useTranslations();

  // Several forms can be mounted at once (the post's own form plus one open
  // reply box), so the ids must be unique per instance rather than hardcoded.
  const uid = useId();
  const bodyId = `comment-body-${uid}`;
  const counterId = `comment-counter-${uid}`;

  const [values, setValues] = useState<CommentValues>(DEFAULT_COMMENT_VALUES);
  const [errors, setErrors] = useState<FieldErrors<CommentValues>>({});
  const [announcement, setAnnouncement] = useState('');

  const create = useCreateComment();
  const pending = create.isPending;
  const remaining = COMMENT_BODY_MAX_LENGTH - values.body.length;
  const isReply = parentId !== null;

  function updateBody(value: string) {
    setValues({ body: value });
    setErrors((current) => (current.body ? { ...current, body: undefined } : current));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = commentSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(toFieldErrors<CommentValues>(parsed.error));
      return;
    }

    setErrors({});
    setAnnouncement('');

    create.mutate(
      { postId, body: parsed.data.body, parentId },
      {
        onSuccess: () => {
          setValues(DEFAULT_COMMENT_VALUES);
          setAnnouncement(isReply ? t('replySuccess') : t('success'));
          toast.success(isReply ? t('replySuccess') : t('success'));
          onDone?.();
        },
      },
    );
  }

  const formLabel = isReply ? t('replyFormLabel', { name: replyingTo ?? '' }) : t('formLabel');

  return (
    <form noValidate onSubmit={handleSubmit} aria-label={formLabel} className="space-y-2">
      {create.isError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {tRoot(errorMessageKey(create.error))}
        </p>
      ) : null}

      <Field
        label={isReply ? t('replyLabel') : t('bodyLabel')}
        htmlFor={bodyId}
        error={errors.body && tValidation(errors.body, { max: COMMENT_BODY_MAX_LENGTH })}
      >
        <Textarea
          id={bodyId}
          name="body"
          rows={isReply ? 2 : 3}
          required
          maxLength={COMMENT_BODY_MAX_LENGTH}
          placeholder={isReply ? t('replyPlaceholder') : t('placeholder')}
          value={values.body}
          onChange={(event) => updateBody(event.target.value)}
          aria-invalid={Boolean(errors.body) || undefined}
          aria-describedby={errors.body ? fieldMessageId(bodyId) : counterId}
          disabled={pending}
          // The reply form appears only in response to a click on "Reply", so
          // moving focus here is the expected behaviour, not a focus steal on
          // page load — which is why the autofocus rule does not object.
          autoFocus={autoFocus}
        />
      </Field>

      <div className="flex items-center justify-between gap-3">
        <span id={counterId} className="text-micro text-muted-foreground tabular-nums">
          {t('counter', { count: remaining })}
        </span>

        <div className="flex items-center gap-2">
          {isReply ? (
            <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={pending}>
              {t('cancel')}
            </Button>
          ) : null}

          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {pending ? t('submitting') : isReply ? t('replySubmit') : t('submit')}
          </Button>
        </div>
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </form>
  );
}
