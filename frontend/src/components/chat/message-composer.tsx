'use client';

import { Loader2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, type KeyboardEvent, useId, useState } from 'react';
import { toast } from 'sonner';

import { Field, fieldMessageId } from '@/components/shared/field';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSendMessage } from '@/hooks/use-chat-actions';
import { errorMessageKey } from '@/lib/api';
import { type FieldErrors, toFieldErrors } from '@/lib/validation/auth';
import {
  EMPTY_MESSAGE_VALUES,
  MESSAGE_BODY_MAX_LENGTH,
  type MessageValues,
  messageSchema,
} from '@/lib/validation/chat';

/**
 * The message box at the bottom of a thread.
 *
 * Enter sends, Shift+Enter breaks the line — the convention every chat has, and
 * the reason this is a `Textarea` with a keydown guard rather than a plain
 * `Input`. A multiline paste still works, and the submit button stays for anyone
 * who cannot use the keyboard that way, so the shortcut is additive.
 *
 * The draft is per-room state owned by the caller-mounted component, so switching
 * rooms discards it; that is intentional — carrying a half-written message into
 * someone else's conversation is the surprising outcome.
 *
 * The mutation is not optimistic (rate-limited, idempotency-keyed): a queued
 * bubble that turns out to have been rejected leaves the user believing they
 * said something they did not.
 */
export function MessageComposer({ roomId }: { roomId: number }) {
  const t = useTranslations('chat.composer');
  const tValidation = useTranslations('chat.validation');
  const tRoot = useTranslations();

  const uid = useId();
  const bodyId = `message-body-${uid}`;
  const counterId = `message-counter-${uid}`;

  const [values, setValues] = useState<MessageValues>(EMPTY_MESSAGE_VALUES);
  const [errors, setErrors] = useState<FieldErrors<MessageValues>>({});
  const [announcement, setAnnouncement] = useState('');

  const send = useSendMessage();
  const pending = send.isPending;
  const remaining = MESSAGE_BODY_MAX_LENGTH - values.body.length;

  function updateBody(value: string) {
    setValues({ body: value });
    setErrors((current) => (current.body ? { ...current, body: undefined } : current));
  }

  function submit() {
    const parsed = messageSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(toFieldErrors<MessageValues>(parsed.error));
      return;
    }

    setErrors({});
    setAnnouncement('');

    send.mutate(
      { roomId, body: parsed.data.body },
      {
        onSuccess: () => {
          setValues(EMPTY_MESSAGE_VALUES);
          setAnnouncement(t('sent'));
          toast.success(t('sent'));
        },
        onError: (error) => {
          // The draft stays in the box on failure — retyping a message because
          // the network blinked is the worse outcome.
          toast.error(tRoot(errorMessageKey(error)));
        },
      },
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // IME composition: pressing Enter to accept a candidate must not send.
    if (event.nativeEvent.isComposing) return;

    event.preventDefault();
    if (!pending) submit();
  }

  return (
    <form noValidate onSubmit={handleSubmit} aria-label={t('formLabel')} className="space-y-2">
      {send.isError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {tRoot(errorMessageKey(send.error))}
        </p>
      ) : null}

      <Field
        label={t('label')}
        htmlFor={bodyId}
        error={errors.body && tValidation(errors.body, { max: MESSAGE_BODY_MAX_LENGTH })}
      >
        <Textarea
          id={bodyId}
          name="body"
          rows={2}
          required
          maxLength={MESSAGE_BODY_MAX_LENGTH}
          placeholder={t('placeholder')}
          value={values.body}
          onChange={(event) => updateBody(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-invalid={Boolean(errors.body) || undefined}
          aria-describedby={errors.body ? fieldMessageId(bodyId) : counterId}
          disabled={pending}
        />
      </Field>

      <div className="flex items-center justify-between gap-3">
        <span id={counterId} className="text-micro text-muted-foreground tabular-nums">
          {t('counter', { count: remaining })}
        </span>

        <Button type="submit" size="sm" disabled={pending}>
          {pending ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <Send aria-hidden="true" />
          )}
          {pending ? t('sending') : t('submit')}
        </Button>
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </form>
  );
}
