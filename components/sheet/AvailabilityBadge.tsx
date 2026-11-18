import { hasText } from '@/lib/format';

/**
 * The hiring line as a pill (bundle AvailabilityBadge, bundle.css 5), the only pill on the site,
 * exactly as the content writes it (`personal.availability`). Renders nothing, and holds no space,
 * when `show` is false (`settings.showAvailabilityBadge`) or the line is empty.
 */
export default function AvailabilityBadge({ text, show = true }: { text: string; show?: boolean }) {
  if (!show || !hasText(text)) return null;
  return (
    <p className="ar-badge">
      <span className="ar-badge__dot" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
