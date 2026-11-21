import SpecTable from '@/components/sheet/SpecTable';

/** A spec table block on glass (the canvas's pj-spec): label and value rows, no outer rules. */
export default function SpecTableBlock({ rows, caption }: { rows: { label: string; value: string }[]; caption?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="pj-spec ar-glass">
      <SpecTable rows={rows} caption={caption} />
    </div>
  );
}
