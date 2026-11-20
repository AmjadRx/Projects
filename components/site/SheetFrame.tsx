import { UI } from '@/lib/strings';
import LitZone from './LitZone';

/**
 * The drawing sheet's border at 1024 px and up (bundle SheetFrame, bundle.css 9): a 1 px rule
 * frame 16 px inside the window, with glass bands outside it like a drawing's trim, and zone marks,
 * 1 to 8 across the top and A to F down the side. Fixed, aria-hidden, never in the way of a click.
 * The mark of the reader's zone is lit and moves with the page (LitZone, motion sheet 7.1). The
 * page keeps the frame's inset from 1024 px (app/styles/frame.css), so nothing sits under the bands.
 */
export default function SheetFrame() {
  return (
    <div className="ar-sheetframe" aria-hidden="true">
      <div className="ar-sheetframe__band ar-sheetframe__band--t" />
      <div className="ar-sheetframe__band ar-sheetframe__band--b" />
      <div className="ar-sheetframe__band ar-sheetframe__band--l" />
      <div className="ar-sheetframe__band ar-sheetframe__band--r" />
      <div className="ar-sheetframe__border" />
      <ol className="ar-sheetframe__cols">
        {UI.site.zoneColumns.map((mark) => (
          <li key={mark}>{mark}</li>
        ))}
      </ol>
      <LitZone marks={UI.site.zoneRows} />
    </div>
  );
}
