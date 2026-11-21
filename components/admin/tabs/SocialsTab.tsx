'use client';

/**
 * Social links (ARCHITECTURE.md 7, kept): each link's id, label, and address, its icon, and the
 * three placement toggles. The icon follows the address (detectIcon in lib/utils.ts, as in v2)
 * until the owner picks another one in the icon select.
 */
import { linkGlyph } from '@/components/sheet/linkGlyph';
import type { SocialLink } from '@/lib/types';
import { detectIcon } from '@/lib/utils';
import { isLinkedInUrl } from '../state/warnings';
import type { EditOptions } from '../state/store';
import { deepCopy, FieldGrid, ListEditor, Select, TextField, Toggle, UrlField, useSiteBinding } from '../ui';
import { TabFrame } from './common';
import { AUTO_ICON, iconChoiceOf, newSocialLink, SOCIAL_ICONS, socialIdIssue, uniqueId, withSocialIcon, withSocialUrl } from './model';

export function SocialsTab() {
  const [links, setLinks] = useSiteBinding<SocialLink[]>('socialLinks');
  const list = links ?? [];
  const ids = list.map((link) => link.id);
  return (
    <TabFrame
      tab="socials"
      description="Where each link appears, and its icon. Email links (mailto:) never show in these lists, because the email comes from Personal; a phone link shows only while Personal has a phone number."
    >
      <ListEditor
        path="socialLinks"
        items={links}
        onChange={setLinks}
        newItem={() => newSocialLink(ids)}
        duplicate={(link) => ({ ...deepCopy(link), id: uniqueId(link.id, ids) })}
        confirmRemove
        label="Social links"
        addLabel="Add a link"
        rowLabel={(link, i) => link.label.trim() || link.id.trim() || `Link ${i + 1}`}
        renderRow={({ item, index, path, update }) => <SocialRow link={item} index={index} path={path} links={list} update={update} />}
      />
    </TabFrame>
  );
}

interface SocialRowProps {
  link: SocialLink;
  index: number;
  /** The row's path, "socialLinks[2]". */
  path: string;
  links: readonly SocialLink[];
  update: (next: SocialLink, edit?: EditOptions) => void;
}

function SocialRow({ link, index, path, links, update }: SocialRowProps) {
  const detected = detectIcon(link.url);
  const iconOptions = [
    { value: AUTO_ICON, label: `Automatic, from the address (${detected})` },
    ...SOCIAL_ICONS.map((name) => ({ value: name, label: name })),
    // An icon name from older content that the list does not have stays selectable.
    ...(link.icon !== '' && !(SOCIAL_ICONS as readonly string[]).includes(link.icon) ? [{ value: link.icon, label: link.icon }] : []),
  ];
  const Glyph = linkGlyph(link.icon, link.url);
  const labelIssue = isLinkedInUrl(link.url) && link.label.trim() !== 'LinkedIn' ? 'A link to LinkedIn is labelled exactly "LinkedIn".' : null;

  return (
    <>
      <FieldGrid columns={2}>
        <TextField
          path={`${path}.label`}
          label="Label"
          issue={labelIssue}
          issueTone="warning"
          value={link.label}
          onChange={(label, edit) => update({ ...link, label }, edit)}
        />
        <TextField
          path={`${path}.id`}
          label="Id"
          mono
          spellCheck={false}
          hint="A short name the site tells links apart by."
          issue={socialIdIssue(links, index)}
          issueTone="warning"
          value={link.id}
          onChange={(id, edit) => update({ ...link, id }, edit)}
        />
      </FieldGrid>
      <UrlField
        path={`${path}.url`}
        label="Address"
        allow={['https', 'mailto', 'tel']}
        hint="An https address, a mailto: address, or a tel: number."
        value={link.url}
        onChange={(url, edit) => update(withSocialUrl(link, url), edit)}
      />
      <Select
        path={`${path}.icon`}
        label="Icon"
        hint={
          <>
            Shown as{' '}
            {Glyph ? (
              <>
                <Glyph size={15} aria-hidden="true" className="adm-link__icon" />{' '}
              </>
            ) : null}
            <span className="adm-mono">{link.icon || detected}</span>. The icon follows the address until you pick another.
          </>
        }
        value={iconChoiceOf(link)}
        options={iconOptions}
        onChange={(choice, edit) => update(withSocialIcon(link, choice), edit)}
      />
      <FieldGrid columns={3}>
        <Toggle path={`${path}.showInNav`} label="Show in the nav" checked={link.showInNav} onChange={(on, edit) => update({ ...link, showInNav: on }, edit)} />
        <Toggle
          path={`${path}.showInFooter`}
          label="Show in the footer"
          checked={link.showInFooter}
          onChange={(on, edit) => update({ ...link, showInFooter: on }, edit)}
        />
        <Toggle
          path={`${path}.showInContact`}
          label="Show on the contact page"
          checked={link.showInContact}
          onChange={(on, edit) => update({ ...link, showInContact: on }, edit)}
        />
      </FieldGrid>
    </>
  );
}
