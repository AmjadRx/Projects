'use client';

/** Navigation (ARCHITECTURE.md 7, kept): the header's links, in order, each with a page picker. */
import type { NavItem } from '@/lib/types';
import { ListEditor, TextField, useSiteBinding } from '../ui';
import { PageLinkField, TabFrame } from './common';

export function NavTab() {
  const [nav, setNav] = useSiteBinding<NavItem[]>('nav');
  return (
    <TabFrame tab="nav" description="The links in the site's header, in this order. A page's nav label is also its heading and title.">
      <ListEditor
        path="nav"
        items={nav}
        onChange={setNav}
        newItem={() => ({ label: '', href: '' })}
        label="Navigation links"
        addLabel="Add a link"
        rowLabel={(item, i) => item.label.trim() || item.href.trim() || `Link ${i + 1}`}
        renderRow={({ item, path, update }) => (
          <>
            <TextField path={`${path}.label`} label="Label" value={item.label} onChange={(label, edit) => update({ ...item, label }, edit)} />
            <PageLinkField path={`${path}.href`} label="Address" value={item.href} onChange={(href, edit) => update({ ...item, href }, edit)} />
          </>
        )}
      />
    </TabFrame>
  );
}
