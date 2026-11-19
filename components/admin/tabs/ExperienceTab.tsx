'use client';

/**
 * Experience (ARCHITECTURE.md 4 and 7): the roles on the Experience page, in order, each with its
 * bullets and logo. A logo uploaded for a role lands on that role even if the roles are reordered
 * while it uploads (components/admin/media/targets.ts).
 */
import type { MediaRef, Site } from '@/lib/types';
import { MediaField } from '../media/index';
import type { EditOptions } from '../state/store';
import { FieldGrid, ListEditor, Section, setIn, TextField, useSiteBinding } from '../ui';
import { TabFrame, TextRows } from './common';
import { SITE_MEDIA_FOLDER } from './model';

type Role = Site['experience'][number];

export function ExperienceTab() {
  const [roles, setRoles] = useSiteBinding<Role[]>('experience');
  return (
    <TabFrame tab="experience" description="The roles on the Experience page, in this order.">
      <Section title="Roles">
        <ListEditor
          path="experience"
          items={roles}
          onChange={setRoles}
          newItem={() => ({ company: '', role: '', location: '', dates: '', bullets: [] })}
          confirmRemove
          label="Roles"
          addLabel="Add a role"
          rowLabel={(role, i) => [role.role, role.company].map((s) => s.trim()).filter(Boolean).join(', ') || `Role ${i + 1}`}
          renderRow={({ item, path, update }) => <RoleRow role={item} path={path} update={update} />}
        />
      </Section>
    </TabFrame>
  );
}

function RoleRow({ role, path, update }: { role: Role; path: string; update: (next: Role, edit?: EditOptions) => void }) {
  const logoPath = `${path}.logo`;
  return (
    <>
      <FieldGrid columns={2}>
        <TextField path={`${path}.company`} label="Company" value={role.company} onChange={(company, edit) => update({ ...role, company }, edit)} />
        <TextField path={`${path}.role`} label="Role" value={role.role} onChange={(title, edit) => update({ ...role, role: title }, edit)} />
        <TextField path={`${path}.location`} label="Location" value={role.location} onChange={(location, edit) => update({ ...role, location }, edit)} />
        <TextField
          path={`${path}.dates`}
          label="Dates"
          hint={'As printed, with "to" between the dates.'}
          value={role.dates}
          onChange={(dates, edit) => update({ ...role, dates }, edit)}
        />
      </FieldGrid>
      <TextRows
        path={`${path}.bullets`}
        items={role.bullets}
        onChange={(bullets, edit) => update({ ...role, bullets }, edit)}
        label="Bullets"
        itemName="Bullet"
        addLabel="Add a bullet"
        rows={2}
      />
      <MediaField
        path={logoPath}
        label="Logo"
        accept={['image']}
        folder={SITE_MEDIA_FOLDER}
        clearable
        value={role.logo}
        onChange={(logo: MediaRef | undefined, edit?: EditOptions) => update(setIn(role, ['logo'], logo), edit)}
      />
    </>
  );
}
