'use client';

/**
 * Contact (ARCHITECTURE.md 4 and 7; docs/V3_PLAN.md 5.7: `resumeRequest` lives here): the Contact
 * page's heading and text, and the resume request button, which opens an email to the address in
 * Personal with the subject and body filled in. No resume file is ever served. The resumeRequest
 * object is created only when the owner turns the button on.
 */
import { hasText } from '@/lib/format';
import type { Site } from '@/lib/types';
import { formatRoute } from '../shell';
import { useAdminStore } from '../state/hooks';
import type { EditOptions } from '../state/store';
import { Section, setIn, TextArea, TextField, Toggle, useSiteBinding } from '../ui';
import { TabFrame, useStoredHas } from './common';
import { withResumeEnabled } from './model';

type ResumeRequest = NonNullable<Site['contact']['resumeRequest']>;

export function ContactTab() {
  const [heading, setHeading] = useSiteBinding<string>('contact.heading');
  const [body, setBody] = useSiteBinding<string>('contact.body');
  return (
    <TabFrame tab="contact" description="The Contact page's heading and text, and the resume request button.">
      <Section title="Heading and text">
        <TextField path="contact.heading" label="Heading" value={heading} onChange={setHeading} />
        <TextArea path="contact.body" label="Body" rows={4} value={body} onChange={setBody} />
      </Section>
      <ResumeRequestSection />
    </TabFrame>
  );
}

function ResumeRequestSection() {
  const store = useAdminStore();
  const storedHas = useStoredHas();
  const [request, setRequest] = useSiteBinding<ResumeRequest | undefined>('contact.resumeRequest');
  const [email] = useSiteBinding<string>('personal.email');
  const address = (email ?? '').trim();
  const enabled = request?.enabled === true;

  const setText = (key: 'label' | 'subject' | 'body') => (text: string, edit: EditOptions) => {
    if (request) setRequest(setIn(request, [key], text), edit);
  };

  return (
    <Section
      title="Resume request"
      description="A button that opens an email to you with this subject and body filled in. No resume file is ever served."
    >
      <Toggle
        path="contact.resumeRequest.enabled"
        label="Show the resume request button"
        checked={enabled}
        onChange={(on) => store.editSite((site) => setIn(site, 'contact', withResumeEnabled(site.contact, on, storedHas('contact.resumeRequest'))))}
      />
      {request ? (
        <>
          <TextField
            path="contact.resumeRequest.label"
            label="Button label"
            issue={enabled && !hasText(request.label) ? 'The button shows only with a label.' : null}
            issueTone="warning"
            value={request.label}
            onChange={setText('label')}
          />
          <TextField path="contact.resumeRequest.subject" label="Email subject" value={request.subject} onChange={setText('subject')} />
          <TextArea path="contact.resumeRequest.body" label="Email body" rows={3} value={request.body} onChange={setText('body')} />
          <p className="adm-muted">
            {address !== '' ? (
              <>
                The email goes to <span className="adm-mono adm-break">{address}</span>, the address in{' '}
                <a className="adm-link" href={formatRoute('personal')}>
                  Personal
                </a>
                .
              </>
            ) : (
              <>
                The button does not show while{' '}
                <a className="adm-link" href={formatRoute('personal')}>
                  Personal
                </a>{' '}
                has no email address.
              </>
            )}
          </p>
        </>
      ) : (
        <p className="adm-muted">Turning the button on adds its label and the email's subject and body here.</p>
      )}
    </Section>
  );
}
