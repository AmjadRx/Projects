import { Calendar, FileText, Film, Github, Linkedin, Mail, Phone, type LucideIcon } from 'lucide-react';
import { detectIcon } from '@/lib/utils';

const GLYPHS: Record<string, LucideIcon> = {
  linkedin: Linkedin,
  github: Github,
  mail: Mail,
  phone: Phone,
  calendar: Calendar,
  file: FileText,
  video: Film,
  youtube: Film,
};

/**
 * The Lucide glyph for a link (a content link's `icon`, else the kind its address shows), drawn
 * with Icon. The bundle allows two brand marks, Lucide's outline LinkedIn and GitHub, and no other
 * logo: a kind without a glyph of its own gets none, and the link's words carry it.
 */
export function linkGlyph(icon: string | undefined, url: string): LucideIcon | null {
  const name = icon && icon.trim() ? icon.trim().toLowerCase() : detectIcon(url);
  return GLYPHS[name] ?? null;
}
