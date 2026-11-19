'use client';

/**
 * About (ARCHITECTURE.md 4 and 7): the About page's heading, paragraphs, facts, and headshot. The
 * skills, education, and honors on that page have their own tabs. A fact whose label names the GPA
 * prints the GPA from Personal (lib/format.ts isGpaFact, D-08), and the editor says so.
 */
import { gpaText, isGpaFact } from '@/lib/format';
import type { Site } from '@/lib/types';
import { FieldGrid, ListEditor, Section, TextArea, TextField, useSiteBinding } from '../ui';
import { SiteMediaField, TabFrame, TextRows } from './common';

type Fact = Site['about']['facts'][number];

export function AboutTab() {
  const [heading, setHeading] = useSiteBinding<string>('about.heading');
  const [paragraphs, setParagraphs] = useSiteBinding<string[]>('about.paragraphs');
  return (
    <TabFrame tab="about" description="The About page: heading, paragraphs, facts, and headshot. Its skills, education, and honors have their own tabs.">
      <Section title="Heading and text">
        <TextArea path="about.heading" label="Heading" rows={2} value={heading} onChange={setHeading} />
        <TextRows path="about.paragraphs" items={paragraphs} onChange={setParagraphs} label="Paragraphs" itemName="Paragraph" addLabel="Add a paragraph" rows={4} />
      </Section>
      <Facts />
      <Section title="Headshot">
        <SiteMediaField path="about.headshot" label="Headshot" accept={['image']} focal clearable />
      </Section>
    </TabFrame>
  );
}

function Facts() {
  const [facts, setFacts] = useSiteBinding<Fact[]>('about.facts');
  const [gpa] = useSiteBinding<string>('personal.gpa');
  const [gpaLabel] = useSiteBinding<string>('personal.gpaLabel');
  const personal = { gpa: gpa ?? '', gpaLabel: gpaLabel ?? '' };
  return (
    <Section title="Facts" description="Label and value pairs beside the text.">
      <ListEditor
        path="about.facts"
        items={facts}
        onChange={setFacts}
        newItem={() => ({ label: '', value: '' })}
        label="Facts"
        addLabel="Add a fact"
        rowLabel={(fact, i) => fact.label.trim() || `Fact ${i + 1}`}
        renderRow={({ item, path, update }) => (
          <>
            <FieldGrid columns={2}>
              <TextField path={`${path}.label`} label="Label" value={item.label} onChange={(label, edit) => update({ ...item, label }, edit)} />
              <TextField path={`${path}.value`} label="Value" value={item.value} onChange={(value, edit) => update({ ...item, value }, edit)} />
            </FieldGrid>
            {isGpaFact(item, personal) ? (
              <p className="adm-muted">
                This row names the GPA, so the site prints the GPA from Personal instead of the value here:{' '}
                {gpaText(personal) !== '' ? <span className="adm-mono">{gpaText(personal)}</span> : 'nothing, while the GPA is empty.'}
              </p>
            ) : null}
          </>
        )}
      />
    </Section>
  );
}
