'use client';

/**
 * Skills (ARCHITECTURE.md 4 and 7; docs/V3_PLAN.md D-21): groups with a tier, and one row per item
 * with its label and a proof picked from the visible projects. Items reorder within a group (drag
 * or the move buttons) and move to another group with the Group select. A label is always one item:
 * nothing here splits or joins labels on commas, so the seed's labels that contain commas, and
 * their proofs, stay as they are.
 */
import { SITE_FILE } from '@/lib/admin/contract';
import { fieldId } from '@/lib/admin/locate';
import type { SkillGroup } from '@/lib/types';
import { plural } from '../shell';
import { useAdminStore } from '../state/hooks';
import type { EditOptions } from '../state/store';
import { Field, FieldGrid, ListEditor, Select, setIn, TextField, useSiteBinding } from '../ui';
import { HELPER, ProjectProofField, TabFrame } from './common';
import { moveSkillItem, SKILL_TIERS, withProof } from './model';

type SkillItem = SkillGroup['items'][number];
type MoveItem = (group: number, item: number, toGroup: number) => void;

export function SkillsTab() {
  const [groups, setGroups] = useSiteBinding<SkillGroup[]>('skills.groups');
  const store = useAdminStore();
  const list = groups ?? [];

  // One undo step; then focus follows the item to the end of its new group.
  const moveItem: MoveItem = (group, item, toGroup) => {
    const before = store.getState().doc?.site.skills.groups;
    const landing = before?.[toGroup]?.items.length ?? 0;
    store.editSite((site) => {
      const next = moveSkillItem(site.skills.groups, group, item, toGroup);
      return next === site.skills.groups ? site : setIn(site, 'skills.groups', next);
    });
    window.requestAnimationFrame(() => {
      document.getElementById(fieldId(SITE_FILE, `skills.groups[${toGroup}].items[${landing}].label`))?.focus();
    });
  };

  return (
    <TabFrame
      tab="skills"
      description="The bill of materials on the About page. One row per item; a proof links the item to a visible project."
    >
      <ListEditor
        path="skills.groups"
        items={groups}
        onChange={setGroups}
        newItem={(): SkillGroup => ({ title: '', tier: 'strong', items: [] })}
        label="Skill groups"
        addLabel="Add a group"
        confirmRemove={(group) => `Remove the group "${group.title.trim() || 'Untitled'}" and its ${plural(group.items.length, 'item')}? Undo brings it back.`}
        rowLabel={(group, i) => `${group.title.trim() || `Group ${i + 1}`} (${group.tier})`}
        renderRow={({ item, index, path, update }) => <GroupRow group={item} index={index} path={path} groups={list} update={update} onMove={moveItem} />}
      />
    </TabFrame>
  );
}

interface GroupRowProps {
  group: SkillGroup;
  index: number;
  /** "skills.groups[1]". */
  path: string;
  groups: readonly SkillGroup[];
  update: (next: SkillGroup, edit?: EditOptions) => void;
  onMove: MoveItem;
}

function GroupRow({ group, index, path, groups, update, onMove }: GroupRowProps) {
  return (
    <>
      <FieldGrid columns={2}>
        <TextField path={`${path}.title`} label="Group title" value={group.title} onChange={(title, edit) => update({ ...group, title }, edit)} />
        <Select path={`${path}.tier`} label="Tier" value={group.tier} options={SKILL_TIERS} onChange={(tier, edit) => update({ ...group, tier }, edit)} />
      </FieldGrid>
      <div className="adm-field">
        <p className="adm-field__label">Items</p>
        <p className="adm-field__hint">
          One row per item. A proof links the item to a visible project; the Group select moves the item to the end of another group.
        </p>
        <ListEditor
          path={`${path}.items`}
          items={group.items}
          onChange={(items, edit) => update({ ...group, items }, edit)}
          newItem={() => ({ label: '' })}
          label={`Items in ${group.title.trim() || `group ${index + 1}`}`}
          addLabel="Add an item"
          rowLabel={(item, i) => item.label.trim() || `Item ${i + 1}`}
          renderRow={({ item, index: i, path: itemPath, update: updateItem }) => (
            <ItemRow item={item} index={i} path={itemPath} group={index} groups={groups} update={updateItem} onMove={onMove} />
          )}
        />
      </div>
    </>
  );
}

interface ItemRowProps {
  item: SkillItem;
  index: number;
  /** "skills.groups[1].items[3]". */
  path: string;
  group: number;
  groups: readonly SkillGroup[];
  update: (next: SkillItem, edit?: EditOptions) => void;
  onMove: MoveItem;
}

function ItemRow({ item, index, path, group, groups, update, onMove }: ItemRowProps) {
  return (
    <>
      <TextField path={`${path}.label`} label="Label" value={item.label} onChange={(label, edit) => update({ ...item, label }, edit)} />
      <FieldGrid columns={2}>
        <ProjectProofField path={`${path}.proof`} value={item.proof} onChange={(proof, edit) => update(withProof(item, proof), edit)} />
        <Field path={`${path}${HELPER}group`} label="Group" value={group}>
          {(control) => (
            <select {...control} className="adm-input adm-select" value={String(group)} onChange={(e) => onMove(group, index, Number(e.target.value))}>
              {groups.map((g, i) => (
                <option key={i} value={String(i)}>
                  {g.title.trim() || `Group ${i + 1}`}
                </option>
              ))}
            </select>
          )}
        </Field>
      </FieldGrid>
    </>
  );
}
