'use client';

/**
 * The editors for the eleven site tabs (ARCHITECTURE.md 7: the twelve tabs kept; Projects has its
 * own editor). Each tab edits content/site.json inside its FileScope, through the store's
 * immutable edits (./model.ts), so an unedited field never changes and typing in one field is one
 * undo step. The Shell renders `SiteTabPanel` for every tab but Projects.
 */
import type { TabId } from '@/lib/admin/locate';
import { AboutTab } from './AboutTab';
import { ContactTab } from './ContactTab';
import { ExperienceTab } from './ExperienceTab';
import { HonorsEduTab } from './HonorsEduTab';
import { NavTab } from './NavTab';
import { PersonalTab } from './PersonalTab';
import { SettingsTab } from './SettingsTab';
import { SkillsTab } from './SkillsTab';
import { SocialsTab } from './SocialsTab';
import { StatsTab } from './StatsTab';
import { ThesisTab } from './ThesisTab';

export type SiteTabId = Exclude<TabId, 'projects'>;

const PANELS: Record<SiteTabId, () => JSX.Element> = {
  settings: SettingsTab,
  personal: PersonalTab,
  socials: SocialsTab,
  nav: NavTab,
  stats: StatsTab,
  thesis: ThesisTab,
  about: AboutTab,
  skills: SkillsTab,
  experience: ExperienceTab,
  honorsEdu: HonorsEduTab,
  contact: ContactTab,
};

export function SiteTabPanel({ tab }: { tab: SiteTabId }) {
  const Panel = PANELS[tab];
  return <Panel />;
}
