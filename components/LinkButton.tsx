import LinkIcon from './LinkIcon';
import { detectIcon } from '@/lib/utils';

interface LinkButtonProps {
  label: string;
  url: string;
  icon?: string;
  size?: 'sm' | 'md';
}

export default function LinkButton({ label, url, icon, size = 'md' }: LinkButtonProps) {
  const resolved = icon || detectIcon(url);
  const external = url.startsWith('http');
  return (
    <a
      href={url}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className={
        size === 'sm'
          ? 'pill transition-colors duration-200 hover:border-accent/60 hover:text-accent'
          : 'btn-ghost'
      }
    >
      <LinkIcon icon={resolved} size={size === 'sm' ? 13 : 15} />
      {label}
    </a>
  );
}
