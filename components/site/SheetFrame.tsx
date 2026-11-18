import { UI } from '@/lib/strings';

/**
 * The drawing sheet's border at 1024 px and up (bundle SheetFrame, bundle.css 9): a 1 px rule
 * frame 16 px inside the window, with glass bands outside it like a drawing's trim, and zone marks,
 * 1 to 8 across the top and A to F down the side. Fixed, aria-hidden, never in the way of a click.
 * Static in Phase 4: lighting the reader's zone as the page scrolls arrives with Phase 5. The page
 * keeps the frame's inset from 1024 px (app/styles/frame.css), so nothing sits under the bands.
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
      <ol className="ar-sheetframe__rows">
        {UI.site.zoneRows.map((mark) => (
          <li key={mark}>{mark}</li>
        ))}
      </ol>
    </div>
  );
}
