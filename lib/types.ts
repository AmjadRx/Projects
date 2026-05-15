export type ProjectColor = 'cyan' | 'purple';
export type RoadmapStatus = 'in-progress' | 'next' | 'future';
export type SkillTier = 'deep' | 'strong';

export interface Personal {
  name: string;
  tagline: string;
  subTagline: string;
  location: string;
  email: string;
  phone: string;
  website: string;
  linkedin: string;
  gpa: string;
  graduation: string;
  school: string;
  degree: string;
}

export interface BrandThesis {
  headline: string;
  body: string;
}

export interface About {
  heading: string;
  paragraphs: string[];
}

export interface Stat {
  label: string;
  value: string;
}

export interface ProjectHero {
  pitch: string;
  highlights: string[];
}

export interface ProjectSection {
  heading: string;
  body?: string;
  items?: string[];
}

export interface RoadmapStage {
  n: number;
  title: string;
  desc: string;
  status: RoadmapStatus;
}

export interface Project {
  slug: string;
  name: string;
  subtitle: string;
  status: string;
  dates: string;
  type: string;
  color: ProjectColor;
  summary: string;
  tags: string[];
  hero?: ProjectHero;
  sections?: ProjectSection[];
  roadmap?: RoadmapStage[];
}

export interface SkillGroup {
  title: string;
  tier: SkillTier;
  items: string[];
}

export interface Skills {
  groups: SkillGroup[];
}

export interface ExperienceItem {
  company: string;
  role: string;
  location: string;
  dates: string;
  bullets: string[];
}

export interface Honor {
  title: string;
  year: string;
  note: string;
}

export interface Education {
  school: string;
  degree: string;
  details: string;
  coursework: string;
}

export interface Contact {
  heading: string;
  primaryCTA: string;
  secondaryCTA: string;
}

export interface Content {
  schemaVersion: number;
  lastUpdated: string;
  personal: Personal;
  brandThesis: BrandThesis;
  about: About;
  stats: Stat[];
  projects: Project[];
  skills: Skills;
  experience: ExperienceItem[];
  honors: Honor[];
  education: Education[];
  contact: Contact;
}
