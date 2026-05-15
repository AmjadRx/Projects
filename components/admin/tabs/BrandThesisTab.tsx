'use client';

import type { BrandThesis } from '@/lib/types';
import { Field, TabHeader } from '../Field';

export default function BrandThesisTab({
  value,
  onChange,
}: {
  value: BrandThesis;
  onChange: (v: BrandThesis) => void;
}) {
  return (
    <div>
      <TabHeader title="Brand thesis" subtitle="The card that frames the EV → drone pivot on the home page." />
      <div className="space-y-5">
        <Field label="Headline">
          <input className="input" value={value.headline} onChange={(e) => onChange({ ...value, headline: e.target.value })} />
        </Field>
        <Field label="Body">
          <textarea
            className="textarea min-h-[140px]"
            value={value.body}
            onChange={(e) => onChange({ ...value, body: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}
