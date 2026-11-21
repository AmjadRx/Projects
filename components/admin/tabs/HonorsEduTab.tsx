'use client';

/** Honors and education (ARCHITECTURE.md 4 and 7): the two lists on the About page. */
import type { Site } from '@/lib/types';
import { FieldGrid, ListEditor, Section, TextArea, TextField, useSiteBinding } from '../ui';
import { TabFrame } from './common';

type Honor = Site['honors'][number];
type School = Site['education'][number];

export function HonorsEduTab() {
  const [honors, setHonors] = useSiteBinding<Honor[]>('honors');
  const [education, setEducation] = useSiteBinding<School[]>('education');
  return (
    <TabFrame tab="honorsEdu" description="The honors and the education entries on the About page, each in this order.">
      <Section title="Honors">
        <ListEditor
          path="honors"
          items={honors}
          onChange={setHonors}
          newItem={() => ({ title: '', year: '', note: '' })}
          label="Honors"
          addLabel="Add an honor"
          rowLabel={(honor, i) => honor.title.trim() || `Honor ${i + 1}`}
          renderRow={({ item, path, update }) => (
            <>
              <FieldGrid columns={2}>
                <TextField path={`${path}.title`} label="Title" value={item.title} onChange={(title, edit) => update({ ...item, title }, edit)} />
                <TextField
                  path={`${path}.year`}
                  label="Year"
                  hint={'A year, or a range with "to".'}
                  value={item.year}
                  onChange={(year, edit) => update({ ...item, year }, edit)}
                />
              </FieldGrid>
              <TextArea path={`${path}.note`} label="Note" rows={2} value={item.note} onChange={(note, edit) => update({ ...item, note }, edit)} />
            </>
          )}
        />
      </Section>
      <Section title="Education">
        <ListEditor
          path="education"
          items={education}
          onChange={setEducation}
          newItem={() => ({ school: '', degree: '', details: '', dates: '' })}
          label="Education"
          addLabel="Add a school"
          rowLabel={(school, i) => school.school.trim() || `School ${i + 1}`}
          renderRow={({ item, path, update }) => (
            <>
              <FieldGrid columns={2}>
                <TextField path={`${path}.school`} label="School" value={item.school} onChange={(school, edit) => update({ ...item, school }, edit)} />
                <TextField path={`${path}.dates`} label="Dates" value={item.dates} onChange={(dates, edit) => update({ ...item, dates }, edit)} />
              </FieldGrid>
              <TextField path={`${path}.degree`} label="Degree" value={item.degree} onChange={(degree, edit) => update({ ...item, degree }, edit)} />
              <TextArea path={`${path}.details`} label="Details" rows={2} value={item.details} onChange={(details, edit) => update({ ...item, details }, edit)} />
            </>
          )}
        />
      </Section>
    </TabFrame>
  );
}
