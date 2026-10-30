import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type FieldProps = {
  label: string;
  /** Id of the control this label points at — also used for the message id. */
  htmlFor: string;
  help?: string;
  /** Localized validation message. Takes precedence over `help`. */
  error?: string;
  invalid?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * Label + control + one message line. Wraps the form markup used on the
 * design-system page and the auth screens, so label/help/destructive styling
 * and the `aria-describedby` target stay identical everywhere.
 *
 * (label আর validation message একই জায়গা থেকে রেন্ডার হলে aria-describedby আর
 *  লাল বর্ডার সব ফর্মে একই রকম থাকে।)
 */
export function Field({
  label,
  htmlFor,
  help,
  error,
  invalid = false,
  className,
  children,
}: FieldProps) {
  const showInvalid = invalid || Boolean(error);
  const message = error ?? help;

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={htmlFor} className={cn(showInvalid && 'text-destructive')}>
        {label}
      </Label>
      {children}
      {message ? (
        <p
          id={fieldMessageId(htmlFor)}
          className={cn('text-micro', showInvalid ? 'text-destructive' : 'text-muted-foreground')}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** Id of the message line a control should point at with `aria-describedby`. */
export function fieldMessageId(controlId: string): string {
  return `${controlId}-message`;
}
