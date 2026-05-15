'use client';

import type { Contact } from '@/lib/types';
import { Field, TabHeader } from '../Field';

export default function ContactTab({
  value,
  onChange,
}: {
  value: Contact;
  onChange: (v: Contact) => void;
}) {
  return (
    <div>
      <TabHeader title="Contact" subtitle="The closing CTA on the home page." />
      <div className="space-y-5">
        <Field label="Heading">
          <input className="input" value={value.heading} onChange={(e) => onChange({ ...value, heading: e.target.value })} />
        </Field>
        <Field label="Primary CTA (email button)">
          <input className="input" value={value.primaryCTA} onChange={(e) => onChange({ ...value, primaryCTA: e.target.value })} />
        </Field>
        <Field label="Secondary CTA (LinkedIn button)">
          <input className="input" value={value.secondaryCTA} onChange={(e) => onChange({ ...value, secondaryCTA: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}
