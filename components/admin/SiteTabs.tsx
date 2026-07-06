'use client';

import type { Site, SocialLink } from '@/lib/types';
import { detectIcon, uid } from '@/lib/utils';
import LinkIcon from '@/components/LinkIcon';
import { AddButton, Area, Field, RowControls, Select, TabHeader, Text, Toggle, move } from './fields';
import { MediaField } from './media';
import ConnectionStatus from './ConnectionStatus';

type Patch = (fn: (site: Site) => Site) => void;

export function SettingsTab({ site, patch }: { site: Site; patch: Patch }) {
  const s = site.settings;
  return (
    <div>
      <TabHeader title="Settings" subtitle="Theme, hero mode, availability." />
      <div className="flex flex-col gap-6">
        <ConnectionStatus />
        <Field
          label="Default theme"
          hint="Applies to first-time visitors. Anyone who has clicked the sun/moon toggle keeps their own choice (stored in a browser cookie) — clear the cookie or toggle again to see the new default yourself."
        >
          <Select
            value={s.themeDefault}
            options={['dark', 'light'] as const}
            onChange={(v) => patch((x) => ({ ...x, settings: { ...x.settings, themeDefault: v } }))}
          />
        </Field>
        <Field label="Hero mode" hint="3D scene renders on desktop only; mobile always uses media/poster.">
          <Select
            value={s.heroMode}
            options={['scene3d', 'media'] as const}
            onChange={(v) => patch((x) => ({ ...x, settings: { ...x.settings, heroMode: v } }))}
          />
        </Field>
        <MediaField
          label="Hero media (used in media mode and on mobile)"
          scope="site"
          value={s.heroMedia}
          allowClear
          onChange={(m) => patch((x) => ({ ...x, settings: { ...x.settings, heroMedia: m } }))}
        />
        <Toggle
          checked={s.showAvailabilityBadge}
          onChange={(v) =>
            patch((x) => ({ ...x, settings: { ...x.settings, showAvailabilityBadge: v } }))
          }
          label="Show availability badge"
        />
        <Field label="Availability text">
          <Text
            value={site.personal.availability}
            onChange={(v) => patch((x) => ({ ...x, personal: { ...x.personal, availability: v } }))}
          />
        </Field>
      </div>
    </div>
  );
}

export function PersonalTab({ site, patch }: { site: Site; patch: Patch }) {
  const p = site.personal;
  const set = (k: keyof Site['personal']) => (v: string) =>
    patch((x) => ({ ...x, personal: { ...x.personal, [k]: v } }));
  return (
    <div>
      <TabHeader title="Personal" subtitle="Identity and headline copy." />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Field label="Name"><Text value={p.name} onChange={set('name')} /></Field>
        <Field label="Location"><Text value={p.location} onChange={set('location')} /></Field>
        <div className="md:col-span-2">
          <Field label="Tagline" hint="Ends with 'move themselves.' to get the accent treatment.">
            <Text value={p.tagline} onChange={set('tagline')} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Sub tagline"><Area value={p.subTagline} onChange={set('subTagline')} /></Field>
        </div>
        <Field label="Email"><Text value={p.email} onChange={set('email')} type="email" /></Field>
        <Field label="Phone"><Text value={p.phone} onChange={set('phone')} /></Field>
        <Field label="GPA"><Text value={p.gpa} onChange={set('gpa')} /></Field>
        <Field label="Graduation"><Text value={p.graduation} onChange={set('graduation')} /></Field>
        <Field label="School"><Text value={p.school} onChange={set('school')} /></Field>
        <Field label="Degree"><Text value={p.degree} onChange={set('degree')} /></Field>
        <div className="md:col-span-2">
          <MediaField
            label="Photo (shown on the home page)"
            scope="site"
            value={p.photo}
            allowClear
            onChange={(m) => patch((x) => ({ ...x, personal: { ...x.personal, photo: m } }))}
          />
        </div>
      </div>
    </div>
  );
}

export function SocialsTab({ site, patch }: { site: Site; patch: Patch }) {
  const setLink = (i: number, link: SocialLink) =>
    patch((x) => ({ ...x, socialLinks: x.socialLinks.map((l, j) => (j === i ? link : l)) }));
  return (
    <div>
      <TabHeader
        title="Social links"
        subtitle="Icons are auto-detected from the URL domain. Toggle where each link appears."
      />
      <div className="flex flex-col gap-4">
        {site.socialLinks.map((link, i) => (
          <div key={link.id} className="card p-4">
            <div className="flex items-center gap-3">
              <span className="text-ink-dim"><LinkIcon icon={link.icon} size={16} /></span>
              <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2">
                <Text value={link.label} onChange={(v) => setLink(i, { ...link, label: v })} placeholder="Label" />
                <Text
                  value={link.url}
                  onChange={(v) => setLink(i, { ...link, url: v, icon: detectIcon(v) })}
                  placeholder="URL"
                />
              </div>
              <RowControls
                canUp={i > 0}
                canDown={i < site.socialLinks.length - 1}
                onUp={() => patch((x) => ({ ...x, socialLinks: move(x.socialLinks, i, i - 1) }))}
                onDown={() => patch((x) => ({ ...x, socialLinks: move(x.socialLinks, i, i + 1) }))}
                onDelete={() =>
                  patch((x) => ({ ...x, socialLinks: x.socialLinks.filter((_, j) => j !== i) }))
                }
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-5">
              <Toggle checked={link.showInNav} onChange={(v) => setLink(i, { ...link, showInNav: v })} label="Nav" />
              <Toggle checked={link.showInFooter} onChange={(v) => setLink(i, { ...link, showInFooter: v })} label="Footer" />
              <Toggle checked={link.showInContact} onChange={(v) => setLink(i, { ...link, showInContact: v })} label="Contact" />
            </div>
          </div>
        ))}
      </div>
      <AddButton
        label="Add link"
        onClick={() =>
          patch((x) => ({
            ...x,
            socialLinks: [
              ...x.socialLinks,
              { id: uid(), label: '', url: '', icon: 'globe', showInNav: false, showInFooter: true, showInContact: true },
            ],
          }))
        }
      />
    </div>
  );
}

export function NavTab({ site, patch }: { site: Site; patch: Patch }) {
  return (
    <div>
      <TabHeader title="Navigation" subtitle="Header links, in order." />
      <div className="flex flex-col gap-3">
        {site.nav.map((item, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="grid flex-1 grid-cols-2 gap-3">
              <Text value={item.label} onChange={(v) => patch((x) => ({ ...x, nav: x.nav.map((n, j) => (j === i ? { ...n, label: v } : n)) }))} placeholder="Label" />
              <Text value={item.href} onChange={(v) => patch((x) => ({ ...x, nav: x.nav.map((n, j) => (j === i ? { ...n, href: v } : n)) }))} placeholder="/#section" />
            </div>
            <RowControls
              canUp={i > 0}
              canDown={i < site.nav.length - 1}
              onUp={() => patch((x) => ({ ...x, nav: move(x.nav, i, i - 1) }))}
              onDown={() => patch((x) => ({ ...x, nav: move(x.nav, i, i + 1) }))}
              onDelete={() => patch((x) => ({ ...x, nav: x.nav.filter((_, j) => j !== i) }))}
            />
          </div>
        ))}
      </div>
      <AddButton label="Add item" onClick={() => patch((x) => ({ ...x, nav: [...x.nav, { label: '', href: '/' }] }))} />
    </div>
  );
}

export function StatsTab({ site, patch }: { site: Site; patch: Patch }) {
  return (
    <div>
      <TabHeader title="Stats" subtitle="Count-up tiles under the hero." />
      <div className="flex flex-col gap-3">
        {site.stats.map((stat, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="grid flex-1 grid-cols-[90px_60px_1fr] gap-3">
              <Text value={stat.value} onChange={(v) => patch((x) => ({ ...x, stats: x.stats.map((s, j) => (j === i ? { ...s, value: v } : s)) }))} placeholder="504" />
              <Text value={stat.suffix ?? ''} onChange={(v) => patch((x) => ({ ...x, stats: x.stats.map((s, j) => (j === i ? { ...s, suffix: v || undefined } : s)) }))} placeholder="V" />
              <Text value={stat.label} onChange={(v) => patch((x) => ({ ...x, stats: x.stats.map((s, j) => (j === i ? { ...s, label: v } : s)) }))} placeholder="Label" />
            </div>
            <RowControls
              canUp={i > 0}
              canDown={i < site.stats.length - 1}
              onUp={() => patch((x) => ({ ...x, stats: move(x.stats, i, i - 1) }))}
              onDown={() => patch((x) => ({ ...x, stats: move(x.stats, i, i + 1) }))}
              onDelete={() => patch((x) => ({ ...x, stats: x.stats.filter((_, j) => j !== i) }))}
            />
          </div>
        ))}
      </div>
      <AddButton label="Add stat" onClick={() => patch((x) => ({ ...x, stats: [...x.stats, { label: '', value: '' }] }))} />
    </div>
  );
}

export function ThesisTab({ site, patch }: { site: Site; patch: Patch }) {
  const t = site.thesis;
  return (
    <div>
      <TabHeader title="Thesis" subtitle="The statement section and its four pillars." />
      <div className="flex flex-col gap-5">
        <Field label="Kicker"><Text value={t.kicker} onChange={(v) => patch((x) => ({ ...x, thesis: { ...x.thesis, kicker: v } }))} /></Field>
        <Field label="Headline"><Area value={t.headline} onChange={(v) => patch((x) => ({ ...x, thesis: { ...x.thesis, headline: v } }))} /></Field>
        <Field label="Body"><Area rows={5} value={t.body} onChange={(v) => patch((x) => ({ ...x, thesis: { ...x.thesis, body: v } }))} /></Field>
        <div>
          <span className="label">Pillars</span>
          <div className="flex flex-col gap-3">
            {t.pillars.map((pillar, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="grid flex-1 grid-cols-[50px_1fr_2fr] gap-3">
                  <Text value={pillar.k} onChange={(v) => patch((x) => ({ ...x, thesis: { ...x.thesis, pillars: x.thesis.pillars.map((p, j) => (j === i ? { ...p, k: v } : p)) } }))} />
                  <Text value={pillar.title} onChange={(v) => patch((x) => ({ ...x, thesis: { ...x.thesis, pillars: x.thesis.pillars.map((p, j) => (j === i ? { ...p, title: v } : p)) } }))} />
                  <Text value={pillar.desc} onChange={(v) => patch((x) => ({ ...x, thesis: { ...x.thesis, pillars: x.thesis.pillars.map((p, j) => (j === i ? { ...p, desc: v } : p)) } }))} />
                </div>
                <RowControls
                  canUp={i > 0}
                  canDown={i < t.pillars.length - 1}
                  onUp={() => patch((x) => ({ ...x, thesis: { ...x.thesis, pillars: move(x.thesis.pillars, i, i - 1) } }))}
                  onDown={() => patch((x) => ({ ...x, thesis: { ...x.thesis, pillars: move(x.thesis.pillars, i, i + 1) } }))}
                  onDelete={() => patch((x) => ({ ...x, thesis: { ...x.thesis, pillars: x.thesis.pillars.filter((_, j) => j !== i) } }))}
                />
              </div>
            ))}
          </div>
          <AddButton label="Add pillar" onClick={() => patch((x) => ({ ...x, thesis: { ...x.thesis, pillars: [...x.thesis.pillars, { k: '', title: '', desc: '' }] } }))} />
        </div>
      </div>
    </div>
  );
}

export function AboutTab({ site, patch }: { site: Site; patch: Patch }) {
  const a = site.about;
  return (
    <div>
      <TabHeader title="About" subtitle="Bio paragraphs, quick facts, headshot." />
      <div className="flex flex-col gap-6">
        <Field label="Heading"><Area value={a.heading} onChange={(v) => patch((x) => ({ ...x, about: { ...x.about, heading: v } }))} /></Field>
        <div>
          <span className="label">Paragraphs</span>
          <div className="flex flex-col gap-3">
            {a.paragraphs.map((paragraph, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="flex-1">
                  <Area rows={4} value={paragraph} onChange={(v) => patch((x) => ({ ...x, about: { ...x.about, paragraphs: x.about.paragraphs.map((p, j) => (j === i ? v : p)) } }))} />
                </div>
                <RowControls
                  canUp={i > 0}
                  canDown={i < a.paragraphs.length - 1}
                  onUp={() => patch((x) => ({ ...x, about: { ...x.about, paragraphs: move(x.about.paragraphs, i, i - 1) } }))}
                  onDown={() => patch((x) => ({ ...x, about: { ...x.about, paragraphs: move(x.about.paragraphs, i, i + 1) } }))}
                  onDelete={() => patch((x) => ({ ...x, about: { ...x.about, paragraphs: x.about.paragraphs.filter((_, j) => j !== i) } }))}
                />
              </div>
            ))}
          </div>
          <AddButton label="Add paragraph" onClick={() => patch((x) => ({ ...x, about: { ...x.about, paragraphs: [...x.about.paragraphs, ''] } }))} />
        </div>
        <div>
          <span className="label">Facts</span>
          <div className="flex flex-col gap-3">
            {a.facts.map((fact, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="grid flex-1 grid-cols-2 gap-3">
                  <Text value={fact.label} onChange={(v) => patch((x) => ({ ...x, about: { ...x.about, facts: x.about.facts.map((f, j) => (j === i ? { ...f, label: v } : f)) } }))} />
                  <Text value={fact.value} onChange={(v) => patch((x) => ({ ...x, about: { ...x.about, facts: x.about.facts.map((f, j) => (j === i ? { ...f, value: v } : f)) } }))} />
                </div>
                <RowControls
                  canUp={i > 0}
                  canDown={i < a.facts.length - 1}
                  onUp={() => patch((x) => ({ ...x, about: { ...x.about, facts: move(x.about.facts, i, i - 1) } }))}
                  onDown={() => patch((x) => ({ ...x, about: { ...x.about, facts: move(x.about.facts, i, i + 1) } }))}
                  onDelete={() => patch((x) => ({ ...x, about: { ...x.about, facts: x.about.facts.filter((_, j) => j !== i) } }))}
                />
              </div>
            ))}
          </div>
          <AddButton label="Add fact" onClick={() => patch((x) => ({ ...x, about: { ...x.about, facts: [...x.about.facts, { label: '', value: '' }] } }))} />
        </div>
        <MediaField label="Headshot" scope="site" value={a.headshot} allowClear onChange={(m) => patch((x) => ({ ...x, about: { ...x.about, headshot: m } }))} />
      </div>
    </div>
  );
}

export function SkillsTab({ site, patch }: { site: Site; patch: Patch }) {
  return (
    <div>
      <TabHeader title="Skills" subtitle="Groups with tiers. Items are comma-separated." />
      <div className="flex flex-col gap-4">
        {site.skills.groups.map((group, i) => (
          <div key={i} className="card p-4">
            <div className="flex items-start gap-3">
              <div className="grid flex-1 grid-cols-[1fr_140px] gap-3">
                <Text value={group.title} onChange={(v) => patch((x) => ({ ...x, skills: { groups: x.skills.groups.map((g, j) => (j === i ? { ...g, title: v } : g)) } }))} />
                <Select
                  value={group.tier}
                  options={['deep', 'strong', 'familiar'] as const}
                  onChange={(v) => patch((x) => ({ ...x, skills: { groups: x.skills.groups.map((g, j) => (j === i ? { ...g, tier: v } : g)) } }))}
                />
              </div>
              <RowControls
                canUp={i > 0}
                canDown={i < site.skills.groups.length - 1}
                onUp={() => patch((x) => ({ ...x, skills: { groups: move(x.skills.groups, i, i - 1) } }))}
                onDown={() => patch((x) => ({ ...x, skills: { groups: move(x.skills.groups, i, i + 1) } }))}
                onDelete={() => patch((x) => ({ ...x, skills: { groups: x.skills.groups.filter((_, j) => j !== i) } }))}
              />
            </div>
            <div className="mt-3">
              <Area
                rows={2}
                value={group.items.join(', ')}
                onChange={(v) =>
                  patch((x) => ({
                    ...x,
                    skills: {
                      groups: x.skills.groups.map((g, j) =>
                        j === i ? { ...g, items: v.split(',').map((s) => s.trim()).filter(Boolean) } : g,
                      ),
                    },
                  }))
                }
              />
            </div>
          </div>
        ))}
      </div>
      <AddButton label="Add group" onClick={() => patch((x) => ({ ...x, skills: { groups: [...x.skills.groups, { title: '', tier: 'strong', items: [] }] } }))} />
    </div>
  );
}

export function ExperienceTab({ site, patch }: { site: Site; patch: Patch }) {
  return (
    <div>
      <TabHeader title="Experience" subtitle="Bullets are one per line." />
      <div className="flex flex-col gap-4">
        {site.experience.map((role, i) => (
          <div key={i} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2">
                <Text value={role.company} onChange={(v) => patch((x) => ({ ...x, experience: x.experience.map((r, j) => (j === i ? { ...r, company: v } : r)) }))} placeholder="Company" />
                <Text value={role.role} onChange={(v) => patch((x) => ({ ...x, experience: x.experience.map((r, j) => (j === i ? { ...r, role: v } : r)) }))} placeholder="Role" />
                <Text value={role.location} onChange={(v) => patch((x) => ({ ...x, experience: x.experience.map((r, j) => (j === i ? { ...r, location: v } : r)) }))} placeholder="Location" />
                <Text value={role.dates} onChange={(v) => patch((x) => ({ ...x, experience: x.experience.map((r, j) => (j === i ? { ...r, dates: v } : r)) }))} placeholder="Dates" />
              </div>
              <RowControls
                canUp={i > 0}
                canDown={i < site.experience.length - 1}
                onUp={() => patch((x) => ({ ...x, experience: move(x.experience, i, i - 1) }))}
                onDown={() => patch((x) => ({ ...x, experience: move(x.experience, i, i + 1) }))}
                onDelete={() => patch((x) => ({ ...x, experience: x.experience.filter((_, j) => j !== i) }))}
              />
            </div>
            <div className="mt-3">
              <span className="label">Bullets (one per line)</span>
              <Area
                rows={5}
                value={role.bullets.join('\n')}
                onChange={(v) =>
                  patch((x) => ({
                    ...x,
                    experience: x.experience.map((r, j) =>
                      j === i ? { ...r, bullets: v.split('\n').filter((s) => s.trim()) } : r,
                    ),
                  }))
                }
              />
            </div>
          </div>
        ))}
      </div>
      <AddButton label="Add role" onClick={() => patch((x) => ({ ...x, experience: [...x.experience, { company: '', role: '', location: '', dates: '', bullets: [] }] }))} />
    </div>
  );
}

export function HonorsEduTab({ site, patch }: { site: Site; patch: Patch }) {
  return (
    <div>
      <TabHeader title="Honors & Education" />
      <div className="flex flex-col gap-8">
        <div>
          <span className="label">Honors</span>
          <div className="flex flex-col gap-3">
            {site.honors.map((honor, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="grid flex-1 grid-cols-1 gap-2 md:grid-cols-[2fr_100px_2fr]">
                  <Text value={honor.title} onChange={(v) => patch((x) => ({ ...x, honors: x.honors.map((h, j) => (j === i ? { ...h, title: v } : h)) }))} placeholder="Title" />
                  <Text value={honor.year} onChange={(v) => patch((x) => ({ ...x, honors: x.honors.map((h, j) => (j === i ? { ...h, year: v } : h)) }))} placeholder="Year" />
                  <Text value={honor.note} onChange={(v) => patch((x) => ({ ...x, honors: x.honors.map((h, j) => (j === i ? { ...h, note: v } : h)) }))} placeholder="Note" />
                </div>
                <RowControls
                  canUp={i > 0}
                  canDown={i < site.honors.length - 1}
                  onUp={() => patch((x) => ({ ...x, honors: move(x.honors, i, i - 1) }))}
                  onDown={() => patch((x) => ({ ...x, honors: move(x.honors, i, i + 1) }))}
                  onDelete={() => patch((x) => ({ ...x, honors: x.honors.filter((_, j) => j !== i) }))}
                />
              </div>
            ))}
          </div>
          <AddButton label="Add honor" onClick={() => patch((x) => ({ ...x, honors: [...x.honors, { title: '', year: '', note: '' }] }))} />
        </div>
        <div>
          <span className="label">Education</span>
          <div className="flex flex-col gap-3">
            {site.education.map((school, i) => (
              <div key={i} className="card flex items-start gap-3 p-4">
                <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2">
                  <Text value={school.school} onChange={(v) => patch((x) => ({ ...x, education: x.education.map((e, j) => (j === i ? { ...e, school: v } : e)) }))} placeholder="School" />
                  <Text value={school.dates} onChange={(v) => patch((x) => ({ ...x, education: x.education.map((e, j) => (j === i ? { ...e, dates: v } : e)) }))} placeholder="Dates" />
                  <Text value={school.degree} onChange={(v) => patch((x) => ({ ...x, education: x.education.map((e, j) => (j === i ? { ...e, degree: v } : e)) }))} placeholder="Degree" />
                  <Text value={school.details} onChange={(v) => patch((x) => ({ ...x, education: x.education.map((e, j) => (j === i ? { ...e, details: v } : e)) }))} placeholder="Details" />
                </div>
                <RowControls
                  canUp={i > 0}
                  canDown={i < site.education.length - 1}
                  onUp={() => patch((x) => ({ ...x, education: move(x.education, i, i - 1) }))}
                  onDown={() => patch((x) => ({ ...x, education: move(x.education, i, i + 1) }))}
                  onDelete={() => patch((x) => ({ ...x, education: x.education.filter((_, j) => j !== i) }))}
                />
              </div>
            ))}
          </div>
          <AddButton label="Add education" onClick={() => patch((x) => ({ ...x, education: [...x.education, { school: '', degree: '', details: '', dates: '' }] }))} />
        </div>
      </div>
    </div>
  );
}

export function ContactTab({ site, patch }: { site: Site; patch: Patch }) {
  return (
    <div>
      <TabHeader title="Contact" subtitle="The closing section." />
      <div className="flex flex-col gap-5">
        <Field label="Heading">
          <Text value={site.contact.heading} onChange={(v) => patch((x) => ({ ...x, contact: { ...x.contact, heading: v } }))} />
        </Field>
        <Field label="Body">
          <Area value={site.contact.body} onChange={(v) => patch((x) => ({ ...x, contact: { ...x.contact, body: v } }))} />
        </Field>
      </div>
    </div>
  );
}
