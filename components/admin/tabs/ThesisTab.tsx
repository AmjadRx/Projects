'use client';

/** Thesis (ARCHITECTURE.md 4 and 7): the home page's statement and its pillars. */
import { hasText } from '@/lib/format';
import type { Site } from '@/lib/types';
import { FieldGrid, ListEditor, Section, TextArea, TextField, useSiteBinding } from '../ui';
import { TabFrame } from './common';

type Pillar = Site['thesis']['pillars'][number];

export function ThesisTab() {
  const [kicker, setKicker] = useSiteBinding<string>('thesis.kicker');
  const [headline, setHeadline] = useSiteBinding<string>('thesis.headline');
  const [body, setBody] = useSiteBinding<string>('thesis.body');
  const [pillars, setPillars] = useSiteBinding<Pillar[]>('thesis.pillars');
  return (
    <TabFrame tab="thesis" description="The statement section on the home page, with its pillars.">
      <Section title="Statement">
        <TextField path="thesis.kicker" label="Kicker" hint="A short line above the headline. Leave it empty to show nothing." value={kicker} onChange={setKicker} />
        <TextArea path="thesis.headline" label="Headline" rows={2} value={headline} onChange={setHeadline} />
        <TextArea path="thesis.body" label="Body" rows={5} value={body} onChange={setBody} />
      </Section>
      <Section title="Pillars">
        <ListEditor
          path="thesis.pillars"
          items={pillars}
          onChange={setPillars}
          newItem={() => ({ k: '', title: '', desc: '' })}
          label="Pillars"
          addLabel="Add a pillar"
          rowLabel={(p, i) => [p.k, p.title].filter(hasText).join(' ') || `Pillar ${i + 1}`}
          renderRow={({ item, path, update }) => (
            <>
              <FieldGrid columns={2}>
                <TextField path={`${path}.k`} label="Mark" hint="A short mark, such as a letter." mono value={item.k} onChange={(k, edit) => update({ ...item, k }, edit)} />
                <TextField path={`${path}.title`} label="Title" value={item.title} onChange={(title, edit) => update({ ...item, title }, edit)} />
              </FieldGrid>
              <TextArea path={`${path}.desc`} label="Description" rows={2} value={item.desc} onChange={(desc, edit) => update({ ...item, desc }, edit)} />
            </>
          )}
        />
      </Section>
    </TabFrame>
  );
}
