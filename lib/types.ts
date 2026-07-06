export type MediaKind = 'image' | 'video' | 'embed';

export interface MediaRef {
  kind: MediaKind;
  src: string;
  alt?: string;
  poster?: string;
  caption?: string;
  /** annotated server-side for local /media paths; never persisted */
  exists?: boolean;
}

export interface SocialLink {
  id: string;
  label: string;
  url: string;
  icon: string;
  showInNav: boolean;
  showInFooter: boolean;
  showInContact: boolean;
}

export interface NavItem {
  label: string;
  href: string;
}

export interface Stat {
  label: string;
  value: string;
  suffix?: string;
}

export interface ThesisPillar {
  k: string;
  title: string;
  desc: string;
}

export interface Site {
  schemaVersion: number;
  settings: {
    themeDefault: 'dark' | 'light';
    heroMode: 'scene3d' | 'media';
    heroMedia?: MediaRef;
    showAvailabilityBadge: boolean;
  };
  personal: {
    name: string;
    tagline: string;
    subTagline: string;
    location: string;
    email: string;
    phone: string;
    availability: string;
    gpa: string;
    graduation: string;
    school: string;
    degree: string;
  };
  socialLinks: SocialLink[];
  nav: NavItem[];
  stats: Stat[];
  thesis: { kicker: string; headline: string; body: string; pillars: ThesisPillar[] };
  about: {
    heading: string;
    paragraphs: string[];
    facts: { label: string; value: string }[];
    headshot?: MediaRef;
  };
  skills: { groups: { title: string; tier: 'deep' | 'strong' | 'familiar'; items: string[] }[] };
  experience: {
    company: string;
    role: string;
    location: string;
    dates: string;
    bullets: string[];
    logo?: MediaRef;
  }[];
  honors: { title: string; year: string; note: string }[];
  education: { school: string; degree: string; details: string; dates: string }[];
  contact: { heading: string; body: string };
}

export type BlockState = 'done' | 'in-progress' | 'next' | 'future';

export type Block =
  | { id: string; type: 'heading'; text: string }
  | { id: string; type: 'text'; md: string }
  | { id: string; type: 'image'; media: MediaRef }
  | { id: string; type: 'gallery'; items: MediaRef[] }
  | { id: string; type: 'video'; media: MediaRef }
  | { id: string; type: 'specTable'; rows: { label: string; value: string }[] }
  | { id: string; type: 'bullets'; heading?: string; items: string[] }
  | { id: string; type: 'twoCol'; left: Block[]; right: Block[] }
  | { id: string; type: 'quote'; text: string; attribution?: string }
  | { id: string; type: 'linkRow'; links: ProjectLink[] }
  | { id: string; type: 'roadmap'; stages: { n: number; title: string; desc: string; status: BlockState }[] }
  | { id: string; type: 'log'; entries: LogEntry[] }
  | { id: string; type: string; [key: string]: unknown };

export interface LogEntry {
  date: string;
  title: string;
  md: string;
  media?: MediaRef[];
}

export interface ProjectLink {
  label: string;
  url: string;
  icon?: string;
}

export type ProjectStatus = 'in-progress' | 'active' | 'completed' | 'shipped';

export interface Project {
  slug: string;
  title: string;
  subtitle: string;
  role: string;
  timeframe: string;
  status: ProjectStatus;
  statusLabel?: string;
  featured: boolean;
  order: number;
  domain: string;
  tags: string[];
  cover: MediaRef;
  links: ProjectLink[];
  pitch: string;
  highlights: string[];
  progress?: { steps: { label: string; state: 'done' | 'current' | 'todo' }[] };
  blocks: Block[];
}

export interface Content {
  site: Site;
  projects: Project[];
}
