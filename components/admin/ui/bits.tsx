'use client';

/**
 * Small display pieces for the admin: Badge, Notice, Section, Kbd. Color is never the only
 * carrier of meaning: a badge has words, and a notice has an icon and, for errors and warnings,
 * a visible word in its title or text.
 */
import { useId, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { cx } from './cx';

export type Tone = 'neutral' | 'info' | 'ok' | 'warning' | 'error';

/** A short status word in a box ("set", "missing", "Required", "building"). */
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('adm-badge', `adm-badge--${tone}`, className)}>{children}</span>;
}

const NOTICE_ICONS: Record<Exclude<Tone, 'neutral'>, ReactNode> = {
  info: <Info size={18} />,
  ok: <CircleCheck size={18} />,
  warning: <TriangleAlert size={18} />,
  error: <CircleAlert size={18} />,
};

export interface NoticeProps {
  tone?: Exclude<Tone, 'neutral'>;
  title?: ReactNode;
  children?: ReactNode;
  /** Announce changes to screen readers (role="status"). Leave off for notices that are there from the start. */
  live?: boolean;
  /** Buttons or links shown under the text. */
  actions?: ReactNode;
  className?: string;
  id?: string;
}

/** A boxed message with an icon: setup problems, refused saves, plain explanations. */
export function Notice({ tone = 'info', title, children, live = false, actions, className, id }: NoticeProps) {
  return (
    <div id={id} className={cx('adm-notice', `adm-notice--${tone}`, className)} role={live ? 'status' : undefined}>
      <span className="adm-notice__icon" aria-hidden="true">
        {NOTICE_ICONS[tone]}
      </span>
      <div className="adm-notice__body">
        {title ? <p className="adm-notice__title">{title}</p> : null}
        {children ? <div className="adm-notice__text">{children}</div> : null}
        {actions ? <div className="adm-notice__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export interface SectionProps {
  title: ReactNode;
  /** A sentence under the title that says what the section edits. */
  description?: ReactNode;
  /** Buttons at the right of the title (Add, Revert). */
  actions?: ReactNode;
  /** Heading level: 2 for a tab's sections (the tab title is the h1), 3 inside them. */
  level?: 2 | 3;
  children?: ReactNode;
  className?: string;
  /** A DOM id for the section, for example the field id of a whole group so a finding can land on it. */
  id?: string;
}

/** A titled group of fields, labelled by its heading for assistive technology. */
export function Section({ title, description, actions, level = 2, children, className, id }: SectionProps) {
  const headingId = useId();
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section id={id} className={cx('adm-section', `adm-section--h${level}`, className)} aria-labelledby={headingId}>
      <div className="adm-section__head">
        <div className="adm-section__titles">
          <Heading id={headingId} className="adm-section__title">
            {title}
          </Heading>
          {description ? <p className="adm-section__desc">{description}</p> : null}
        </div>
        {actions ? <div className="adm-section__actions">{actions}</div> : null}
      </div>
      <div className="adm-section__body">{children}</div>
    </section>
  );
}

/**
 * Fields side by side when the admin is wide enough (640 px of admin width and up), stacked on a
 * phone: <FieldGrid columns={2}>...</FieldGrid>.
 */
export function FieldGrid({ columns = 2, children, className }: { columns?: 2 | 3; children: ReactNode; className?: string }) {
  return <div className={cx('adm-grid', `adm-grid--${columns}`, className)}>{children}</div>;
}

/** A key on the keyboard, for shortcut hints: <Kbd>Ctrl</Kbd> + <Kbd>S</Kbd>. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="adm-kbd">{children}</kbd>;
}

/** The title row of a tab panel: its one h1 and a sentence about what it edits. */
export function PanelHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="adm-panelhead">
      <div>
        <h1 className="adm-panelhead__title">{title}</h1>
        {description ? <p className="adm-panelhead__desc">{description}</p> : null}
      </div>
      {actions ? <div className="adm-panelhead__actions">{actions}</div> : null}
    </header>
  );
}
