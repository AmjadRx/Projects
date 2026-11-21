'use client';

/**
 * Personal (ARCHITECTURE.md 4 `personal`; docs/V3_PLAN.md 5.7: `gpaLabel` and `now` live here):
 * name, headline, contact details, degree and GPA, the availability line, the photo, and the
 * home page's Now list.
 *
 * The phone and the GPA may be empty, which hides every element that shows them (D-14, Q-23); the
 * GPA label is required whenever a GPA is set, and the GPA always prints as label and value (D-08).
 */
import { gpaText } from '@/lib/format';
import type { Site } from '@/lib/types';
import { DOCUMENTED_AVAILABILITY } from '../state/warnings';
import { FieldGrid, ListEditor, Section, TextArea, TextField, useSiteBinding } from '../ui';
import { PageLinkField, PrintedAs, SiteMediaField, TabFrame, useStoredHas } from './common';
import { gpaLabelIssue, withOptionalText } from './model';

type NowItem = Site['now'][number];

export function PersonalTab() {
  return (
    <TabFrame tab="personal" description="Your name, the headline, contact details, degree and GPA, the availability line, the photo, and the Now list on the home page.">
      <NameAndHeadline />
      <ContactDetails />
      <DegreeAndGpa />
      <Availability />
      <Section title="Photo" description="Shown on the home page.">
        <SiteMediaField path="personal.photo" label="Photo" accept={['image']} focal clearable />
      </Section>
      <Now />
    </TabFrame>
  );
}

function NameAndHeadline() {
  const [name, setName] = useSiteBinding<string>('personal.name');
  const [location, setLocation] = useSiteBinding<string>('personal.location');
  const [tagline, setTagline] = useSiteBinding<string>('personal.tagline');
  const [subTagline, setSubTagline] = useSiteBinding<string>('personal.subTagline');
  return (
    <Section title="Name and headline">
      <FieldGrid columns={2}>
        <TextField path="personal.name" label="Name" value={name} onChange={setName} />
        <TextField path="personal.location" label="Location" value={location} onChange={setLocation} />
      </FieldGrid>
      <TextField path="personal.tagline" label="Tagline" hint="The headline at the top of the home page." value={tagline} onChange={setTagline} />
      <TextArea path="personal.subTagline" label="Sub-tagline" hint="The paragraph under the headline." rows={3} value={subTagline} onChange={setSubTagline} />
    </Section>
  );
}

function ContactDetails() {
  const [email, setEmail] = useSiteBinding<string>('personal.email');
  const [phone, setPhone] = useSiteBinding<string>('personal.phone');
  return (
    <Section title="Contact details">
      <FieldGrid columns={2}>
        <TextField
          path="personal.email"
          label="Email"
          type="email"
          inputMode="email"
          spellCheck={false}
          hint="The email button and the resume request write to this address."
          value={email}
          onChange={setEmail}
        />
        <TextField
          path="personal.phone"
          label="Phone"
          type="tel"
          inputMode="tel"
          hint="Leave it empty to hide the phone everywhere."
          value={phone}
          onChange={setPhone}
        />
      </FieldGrid>
      <p className="adm-muted">
        While the phone is empty, a save is refused if the number still appears in another field, such as the phone link in Social links.
      </p>
    </Section>
  );
}

function DegreeAndGpa() {
  const [school, setSchool] = useSiteBinding<string>('personal.school');
  const [degree, setDegree] = useSiteBinding<string>('personal.degree');
  const [graduation, setGraduation] = useSiteBinding<string>('personal.graduation');
  const [gpaLabel, setGpaLabel] = useSiteBinding<string>('personal.gpaLabel');
  const [gpa, setGpa] = useSiteBinding<string>('personal.gpa');
  const personal = { gpa: gpa ?? '', gpaLabel: gpaLabel ?? '' };
  const hasGpa = personal.gpa.trim() !== '';
  return (
    <Section title="Degree and GPA">
      <FieldGrid columns={2}>
        <TextField path="personal.school" label="School" value={school} onChange={setSchool} />
        <TextField path="personal.graduation" label="Graduation" value={graduation} onChange={setGraduation} />
      </FieldGrid>
      <TextField path="personal.degree" label="Degree" value={degree} onChange={setDegree} />
      <FieldGrid columns={2}>
        <TextField
          path="personal.gpaLabel"
          label="GPA label"
          required={hasGpa}
          hint="Printed before the value, every time."
          issue={gpaLabelIssue(personal)}
          value={gpaLabel}
          onChange={setGpaLabel}
        />
        <TextField
          path="personal.gpa"
          label="GPA"
          mono
          inputMode="decimal"
          hint="Leave it empty to hide every GPA element."
          value={gpa}
          onChange={setGpa}
        />
      </FieldGrid>
      <PrintedAs
        text={gpaText(personal)}
        empty={hasGpa ? 'Not printed until the GPA label is set.' : 'Not printed: with no GPA, every GPA element is hidden.'}
      />
      <p className="adm-muted">
        While the GPA is empty, a save is refused if a GPA still appears in another field, such as an About fact or an education line.
      </p>
    </Section>
  );
}

function Availability() {
  const [availability, setAvailability] = useSiteBinding<string>('personal.availability');
  const line = (availability ?? '').trim();
  return (
    <Section title="Availability">
      <TextField
        path="personal.availability"
        label="Availability line"
        hint={`Shown by the availability badge (Settings). The documented line is: ${DOCUMENTED_AVAILABILITY}`}
        issue={line !== '' && line !== DOCUMENTED_AVAILABILITY ? 'This differs from the documented availability line.' : null}
        issueTone="warning"
        value={availability}
        onChange={setAvailability}
      />
    </Section>
  );
}

function Now() {
  const [now, setNow] = useSiteBinding<NowItem[]>('now');
  const storedHas = useStoredHas();
  return (
    <Section title="Now" description="A short list on the home page. A link is optional: pick a page, or type an address.">
      <ListEditor
        path="now"
        items={now}
        onChange={setNow}
        newItem={() => ({ label: '' })}
        label="Now items"
        addLabel="Add an item"
        rowLabel={(item, i) => item.label.trim() || `Item ${i + 1}`}
        renderRow={({ item, path, update }) => (
          <>
            <TextField path={`${path}.label`} label="Label" value={item.label} onChange={(label, edit) => update({ ...item, label }, edit)} />
            <PageLinkField
              path={`${path}.href`}
              label="Link"
              optional
              value={item.href}
              onChange={(href, edit) => update(withOptionalText(item, 'href', href, storedHas(`${path}.href`)), edit)}
            />
          </>
        )}
      />
    </Section>
  );
}
