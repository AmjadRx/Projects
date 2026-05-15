'use client';

import type { Personal } from '@/lib/types';
import { Field, TabHeader } from '../Field';

export default function PersonalTab({
  value,
  onChange,
}: {
  value: Personal;
  onChange: (v: Personal) => void;
}) {
  const upd = <K extends keyof Personal>(k: K, v: Personal[K]) => onChange({ ...value, [k]: v });
  return (
    <div>
      <TabHeader title="Personal" subtitle="The top-line identity surface for the site." />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field label="Full name">
          <input className="input" value={value.name} onChange={(e) => upd('name', e.target.value)} />
        </Field>
        <Field label="Location">
          <input className="input" value={value.location} onChange={(e) => upd('location', e.target.value)} />
        </Field>
        <Field label="Tagline" hint="The headline. Use 'move themselves.' to trigger the cyan accent.">
          <input className="input" value={value.tagline} onChange={(e) => upd('tagline', e.target.value)} />
        </Field>
        <Field label="Sub-tagline">
          <input className="input" value={value.subTagline} onChange={(e) => upd('subTagline', e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={value.email} onChange={(e) => upd('email', e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="input" value={value.phone} onChange={(e) => upd('phone', e.target.value)} />
        </Field>
        <Field label="LinkedIn URL">
          <input className="input" value={value.linkedin} onChange={(e) => upd('linkedin', e.target.value)} />
        </Field>
        <Field label="Website">
          <input className="input" value={value.website} onChange={(e) => upd('website', e.target.value)} />
        </Field>
        <Field label="GPA">
          <input className="input" value={value.gpa} onChange={(e) => upd('gpa', e.target.value)} />
        </Field>
        <Field label="Graduation year">
          <input className="input" value={value.graduation} onChange={(e) => upd('graduation', e.target.value)} />
        </Field>
        <Field label="School">
          <input className="input" value={value.school} onChange={(e) => upd('school', e.target.value)} />
        </Field>
        <Field label="Degree">
          <input className="input" value={value.degree} onChange={(e) => upd('degree', e.target.value)} />
        </Field>
      </div>
    </div>
  );
}
