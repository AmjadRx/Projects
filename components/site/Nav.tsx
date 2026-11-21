import Link from 'next/link';
import { Calendar, Github, Globe, Linkedin, Mail, Phone, Search, type LucideIcon } from 'lucide-react';
import PaletteTrigger from '@/components/palette/PaletteTrigger';
import Icon from '@/components/sheet/Icon';
import { hasText } from '@/lib/format';
import type { NavItem } from '@/lib/site';
import { UI } from '@/lib/strings';
import type { Theme } from '@/lib/theme';
import type { SocialLink } from '@/lib/types';
import HeatRule from './HeatRule';
import MobileMenu from './MobileMenu';
import NavLinks from './NavLinks';
import ThemeToggle, { type ThemeToggleLabels } from './ThemeToggle';

/** Lucide glyphs for the social links; the bundle allows the two brand glyphs, LinkedIn and GitHub. */
const SOCIAL_ICONS: Record<string, LucideIcon> = {
  linkedin: Linkedin,
  github: Github,
  mail: Mail,
  calendar: Calendar,
  phone: Phone,
};

/**
 * The sticky nav on every page (bundle Nav, bundle.css 8): glass, 64 px, a rule along its foot.
 * The name, the links from `nav` (already resolved by navItemsFor, so a hidden page has no item),
 * the social links with showInNav as icon and word (CONTENT_RULES.md 4: LinkedIn is shown as the
 * word "LinkedIn"), and the compact theme toggle, from 1024 px; below that, the name and the Menu
 * button. The search button opens the command palette at every width (components/palette/; its
 * icon and words are drawn here, on the server; app/palette.css fits the row to it down to 320 px,
 * with Menu as its icon alone under 360 px). Along its foot runs the heat rule, the page
 * progress cold to hot (HeatRule, motion sheet 7.1). The nav itself never moves or hides on scroll.
 * Inside the sheet frame it starts at the frame's inset.
 */
export default function Nav({
  name,
  items,
  socials,
  availability,
  theme,
}: {
  name: string;
  items: NavItem[];
  /** socialLinksFor(site, 'nav'). */
  socials: SocialLink[];
  /** The hiring line for the phone menu, only when the setting shows it. */
  availability?: string;
  /** The theme the server renders (the content's default). */
  theme: Theme;
}) {
  const themeLabels: ThemeToggleLabels = {
    group: UI.site.theme,
    blueprint: UI.site.blueprint,
    whiteprint: UI.site.whiteprint,
    blueprintTheme: UI.site.blueprintTheme,
    whiteprintTheme: UI.site.whiteprintTheme,
  };
  return (
    <header className="ar-nav ar-nav--sticky">
      <div className="ar-nav__in">
        <Link href="/" className="ar-nav__name">
          {name}
        </Link>
        <nav aria-label={UI.site.primaryNav}>
          <NavLinks items={items} />
        </nav>
        <div className="ar-nav__tools">
          {socials.map((social) => (
            <a
              key={social.id}
              href={social.url}
              rel={/^https?:\/\//i.test(social.url) ? 'noopener noreferrer' : undefined}
              className="ar-nav__social ar-nav__social--word ar-nav__desk"
            >
              <Icon icon={SOCIAL_ICONS[social.icon] ?? Globe} size={20} />
              <span>{social.label}</span>
            </a>
          ))}
          <PaletteTrigger label={UI.palette.open}>
            <Icon icon={Search} size={18} />
            <span className="ar-nav__search-text">{UI.palette.search}</span>
            <kbd className="ar-nav__kbd">{UI.palette.shortcut}</kbd>
          </PaletteTrigger>
          <span className="ar-nav__desk">
            <ThemeToggle variant="compact" labels={themeLabels} initial={theme} />
          </span>
          <MobileMenu
            name={name}
            items={items}
            socials={socials.map((s) => ({ label: s.label, url: s.url, external: /^https?:\/\//i.test(s.url) }))}
            availability={hasText(availability) ? availability : undefined}
            labels={{ menu: UI.site.menu, close: UI.site.close, nav: UI.site.primaryNav, theme: themeLabels }}
            initialTheme={theme}
          />
        </div>
      </div>
      <HeatRule />
    </header>
  );
}
