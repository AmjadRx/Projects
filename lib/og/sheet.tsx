/**
 * The Open Graph images, drawn as a Blueprint sheet (ARCHITECTURE.md 5, "Also new";
 * DESIGN_DIRECTION.md 2.4, place 6, 4, and 5.1): the frame with its zone marks (1 to 8 across the
 * top, A to F down the side, as components/site/SheetFrame.tsx draws them), the drawing grid, the
 * heat rule under the top of the frame, and the title block in the bottom right corner. The home
 * image sets the headline; a project image sets its title and subtitle and fills the title block,
 * with the maturity scale in the ramp. Text and lines only: no photograph and no generated picture.
 *
 * The elements are for next/og's renderer (satori): every box is a flex box, every line of text is
 * measured and broken in lib/og/text.ts and then drawn whole, and no style key is left undefined
 * (the renderer refuses one).
 */
import type { CSSProperties, ReactNode } from 'react';
import { UI } from '../strings';
import { OG_HEIGHT, OG_WIDTH, type Card, type HomeCard, type ProjectCard } from './cards';
import { face, type FaceName } from './fonts';
import type { Palette } from './palette';
import { breakLines, fitText, wordsFit } from './text';

/** The frame's band: the frame line sits this far in, with the zone marks in the band. */
const BAND = 24;
const FRAME_W = OG_WIDTH - 2 * BAND;
const FRAME_H = OG_HEIGHT - 2 * BAND;
/** The heat rule under the frame's top line (the nav's heat rule, read to the end). */
const HEAT = 4;
/** The text's inset from the frame line, and its top. */
const INSET = 56;
const LEFT = BAND + INSET;
const TOP = BAND + HEAT + INSET - 4;
/** The gap between the text and the title block. */
const GAP = 48;

/** The drawing grid, as app/sheet.css draws it (--grid-step-minor and --grid-step-major). */
const MINOR = 8;
const MAJOR = 64;
/** Zone ticks and marks, as app/sheet.css 9 draws them. */
const TICK = 6;
const MARK_SIZE = 13;

/** The title block's widths, and its fixed end cells. */
const PROJECT_BLOCK = 456;
const HOME_BLOCK = 380;
const SHEET_CELL = 140;
const REV_CELL = 170;
/** Title block cell padding, and the gap under a label. */
const CELL_X = 18;
const CELL_Y = 13;
const LABEL_GAP = 3;

/** Type in px: the title block's labels, values, and lead value; the scale's label; the subtitle. */
const LABEL = { size: 14, line: 20, tracking: 0.08 };
const VALUE_SIZES = [20, 18, 16];
const LEAD_SIZES = [26, 24, 22, 20];
const NOTE = { size: 19, line: 27 };
const SUBTITLE = { size: 28, line: 39 };
/** Headline and title: the pages' tracking (-0.02em) and line heights (0.98 and 1.02). */
const TRACKING = -0.02;
const HEADLINE_LINE = 0.98;
const TITLE_LINE = 1.02;
const HEADLINE_FIT = { max: 104, min: 56, maxLines: 3 };
const TITLE_FIT = { max: 120, min: 44, maxLines: 3 };
const SUBTITLE_GAP = 18;

/** The maturity scale's cells (app/sheet.css 12). */
const SCALE_H = 16;
const SCALE_GAP = 4;

const lineOf = (size: number) => Math.round(size * 1.33);

function measure(name: FaceName, tracking = 0) {
  return (size: number) => (text: string) => face(name).width(text, size, tracking * size);
}

function Lines({
  lines,
  name,
  size,
  line,
  color,
  tracking = 0,
  upper = false,
}: {
  lines: string[];
  name: FaceName;
  size: number;
  line: number;
  color: string;
  tracking?: number;
  upper?: boolean;
}) {
  const f = face(name);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {lines.map((text, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            whiteSpace: 'nowrap',
            fontFamily: f.family,
            fontWeight: f.weight,
            fontSize: size,
            lineHeight: `${line}px`,
            height: line,
            ...(tracking ? { letterSpacing: tracking * size } : {}),
            ...(upper ? { textTransform: 'uppercase' as const } : {}),
            color,
          }}
        >
          {text}
        </div>
      ))}
    </div>
  );
}

/** The frame, the grid, the zone ticks, and the heat rule: one SVG layer under the text. */
function SheetLayer({ palette }: { palette: Palette }) {
  const cols = UI.site.zoneColumns.length;
  const rows = UI.site.zoneRows.length;
  const ramp = palette.ramp;
  return (
    <svg width={OG_WIDTH} height={OG_HEIGHT} viewBox={`0 0 ${OG_WIDTH} ${OG_HEIGHT}`} style={{ position: 'absolute', left: 0, top: 0 }}>
      <defs>
        <pattern id="minor" x={BAND} y={BAND} width={MINOR} height={MINOR} patternUnits="userSpaceOnUse">
          <rect x={0} y={0} width={MINOR} height={1} fill={palette.gridMinor} />
          <rect x={0} y={0} width={1} height={MINOR} fill={palette.gridMinor} />
        </pattern>
        <pattern id="major" x={BAND} y={BAND} width={MAJOR} height={MAJOR} patternUnits="userSpaceOnUse">
          <rect x={0} y={0} width={MAJOR} height={1} fill={palette.gridMajor} />
          <rect x={0} y={0} width={1} height={MAJOR} fill={palette.gridMajor} />
        </pattern>
        <linearGradient id="heat" x1="0" y1="0" x2="1" y2="0">
          {ramp.map((color, i) => (
            <stop key={i} offset={i / (ramp.length - 1)} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      <rect x={BAND} y={BAND} width={FRAME_W} height={FRAME_H} fill="url(#minor)" />
      <rect x={BAND} y={BAND} width={FRAME_W} height={FRAME_H} fill="url(#major)" />
      <rect x={BAND + 0.5} y={BAND + 0.5} width={FRAME_W - 1} height={FRAME_H - 1} fill="none" stroke={palette.rule} strokeWidth={1} />
      {Array.from({ length: cols - 1 }, (_, k) => (
        <rect key={`c${k}`} x={BAND + ((k + 1) * FRAME_W) / cols} y={BAND - TICK} width={1} height={TICK} fill={palette.rule} />
      ))}
      {Array.from({ length: rows - 1 }, (_, k) => (
        <rect key={`r${k}`} x={BAND - TICK} y={BAND + ((k + 1) * FRAME_H) / rows} width={TICK} height={1} fill={palette.rule} />
      ))}
      <rect x={BAND + 1} y={BAND + 1} width={FRAME_W - 2} height={HEAT} fill="url(#heat)" />
    </svg>
  );
}

function ZoneMarks({ palette }: { palette: Palette }) {
  const mono = face('mono');
  const cols = UI.site.zoneColumns;
  const rows = UI.site.zoneRows;
  const mark: CSSProperties = {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: mono.family,
    fontSize: MARK_SIZE,
    color: palette.inkMute,
  };
  return (
    <>
      {cols.map((label, k) => (
        <div key={`c${label}`} style={{ ...mark, left: BAND + (k * FRAME_W) / cols.length, top: 0, width: FRAME_W / cols.length, height: BAND }}>
          {label}
        </div>
      ))}
      {rows.map((label, k) => (
        <div key={`r${label}`} style={{ ...mark, left: 0, top: BAND + (k * FRAME_H) / rows.length, width: BAND, height: FRAME_H / rows.length }}>
          {label}
        </div>
      ))}
    </>
  );
}

function Sheet({ palette, children }: { palette: Palette; children: ReactNode }) {
  return (
    <div style={{ position: 'relative', display: 'flex', width: OG_WIDTH, height: OG_HEIGHT, backgroundColor: palette.sheet }}>
      <SheetLayer palette={palette} />
      <ZoneMarks palette={palette} />
      {children}
    </div>
  );
}

/** A title block cell: its label, and either its value's lines or a maturity scale. */
interface Cell {
  label: string;
  width: number;
  value?: { lines: string[]; size: number; line: number };
  scale?: { step: number; lines: string[] };
}

/** A title block row: one cell across, or a cell and an end cell (SHEET, REV) beside it. */
type Row = Cell[];

/** A value set in B612 Mono for a cell of `width`: the first size at which every word fits whole. */
function cellValue(text: string, width: number, sizes: readonly number[]): Cell['value'] {
  const inner = width - 2 * CELL_X;
  const at = measure('mono');
  const size = sizes.find((s) => wordsFit(text, at(s), inner)) ?? sizes[sizes.length - 1];
  return { lines: breakLines(text, at(size), inner), size, line: lineOf(size) };
}

function cellHeight(cell: Cell): number {
  const body = cell.scale
    ? 8 + SCALE_H + 8 + cell.scale.lines.length * NOTE.line
    : LABEL_GAP + (cell.value ? cell.value.lines.length * cell.value.line : 0);
  return 2 * CELL_Y + LABEL.line + body;
}

function rowHeight(row: Row): number {
  return Math.max(...row.map(cellHeight));
}

/** The block's outer height: its rows, a rule between rows, and its border. */
function blockHeight(rows: Row[]): number {
  return rows.reduce((sum, row, r) => sum + rowHeight(row) + (r > 0 ? 1 : 0), 2);
}

/** The maturity scale: five cells, the reached ones filled with their slice of the ramp (app/sheet.css 12). */
function MaturityCells({ step, width, palette }: { step: number; width: number; palette: Palette }) {
  const cell = (width - SCALE_GAP * 4) / 5;
  // The scale's ramp runs t1 to t6 across the five cells (--heat-scale): cell i shows t(i + 1) to t(i + 2).
  const ramp = palette.ramp;
  return (
    <svg width={width} height={SCALE_H} viewBox={`0 0 ${width} ${SCALE_H}`}>
      <defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <linearGradient key={i} id={`ms${i}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset={0} stopColor={ramp[i + 1]} />
            <stop offset={1} stopColor={ramp[i + 2]} />
          </linearGradient>
        ))}
      </defs>
      {[0, 1, 2, 3, 4].map((i) => {
        const x = i * (cell + SCALE_GAP);
        return i < step ? (
          <g key={i}>
            <rect x={x + 0.5} y={0.5} width={cell - 1} height={SCALE_H - 1} fill="none" stroke={palette.inkDim} strokeWidth={1} />
            <rect x={x + 2} y={2} width={cell - 4} height={SCALE_H - 4} fill={`url(#ms${i})`} />
          </g>
        ) : (
          <rect key={i} x={x + 0.5} y={0.5} width={cell - 1} height={SCALE_H - 1} fill="none" stroke={palette.inkMute} strokeWidth={1} strokeDasharray="3 3" />
        );
      })}
    </svg>
  );
}

function CellView({ cell, palette, top, left }: { cell: Cell; palette: Palette; top: boolean; left: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: cell.width,
        padding: `${CELL_Y}px ${CELL_X}px`,
        ...(top ? { borderTop: `1px solid ${palette.rule}` } : {}),
        ...(left ? { borderLeft: `1px solid ${palette.rule}` } : {}),
      }}
    >
      <Lines lines={[cell.label]} name="mono" size={LABEL.size} line={LABEL.line} color={palette.inkMute} tracking={LABEL.tracking} upper />
      {cell.scale ? (
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
          <MaturityCells step={cell.scale.step} width={cell.width - 2 * CELL_X} palette={palette} />
          <div style={{ display: 'flex', marginTop: 8 }}>
            <Lines lines={cell.scale.lines} name="subtitle" size={NOTE.size} line={NOTE.line} color={palette.inkDim} />
          </div>
        </div>
      ) : cell.value ? (
        <div style={{ display: 'flex', marginTop: LABEL_GAP }}>
          <Lines lines={cell.value.lines} name="mono" size={cell.value.size} line={cell.value.line} color={palette.ink} />
        </div>
      ) : null}
    </div>
  );
}

/** The title block, in the bottom right corner, its outer lines on the frame's (DESIGN_DIRECTION.md 5.1). */
function TitleBlock({ rows, width, palette }: { rows: Row[]; width: number; palette: Palette }) {
  return (
    <div
      style={{
        position: 'absolute',
        right: BAND,
        bottom: BAND,
        display: 'flex',
        flexDirection: 'column',
        width,
        border: `1px solid ${palette.line}`,
        backgroundColor: palette.glass,
      }}
    >
      {rows.map((row, r) => (
        <div key={r} style={{ display: 'flex', flexDirection: 'row', height: rowHeight(row) + (r > 0 ? 1 : 0) }}>
          {row.map((cell, c) => (
            <CellView key={c} cell={cell} palette={palette} top={r > 0} left={c > 0} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A project's title block, as components/sheet/TitleBlock.tsx lays it out; a field with no value has no cell. */
function projectRows(card: ProjectCard, width = PROJECT_BLOCK): Row[] {
  const sheet = `${card.sheet} ${UI.titleBlock.of.toUpperCase()} ${card.sheets}`;
  const rows: Row[] = [
    [
      { label: UI.titleBlock.project, width: width - SHEET_CELL, value: cellValue(card.title, width - SHEET_CELL, LEAD_SIZES) },
      { label: UI.titleBlock.sheet, width: SHEET_CELL, value: cellValue(sheet, SHEET_CELL, VALUE_SIZES) },
    ],
  ];
  if (card.role) rows.push([{ label: UI.titleBlock.role, width, value: cellValue(card.role, width, VALUE_SIZES) }]);
  if (card.dates) rows.push([{ label: UI.titleBlock.dates, width, value: cellValue(card.dates, width, VALUE_SIZES) }]);
  if (card.rev) {
    rows.push([
      { label: UI.titleBlock.status, width: width - REV_CELL, value: cellValue(card.status, width - REV_CELL, VALUE_SIZES) },
      { label: UI.titleBlock.rev, width: REV_CELL, value: cellValue(card.rev, REV_CELL, VALUE_SIZES) },
    ]);
  } else {
    rows.push([{ label: UI.titleBlock.status, width, value: cellValue(card.status, width, VALUE_SIZES) }]);
  }
  if (card.maturity) {
    const lines = breakLines(card.maturity.label, measure('subtitle')(NOTE.size), width - 2 * CELL_X);
    rows.push([{ label: UI.maturity.label, width, scale: { step: card.maturity.step, lines } }]);
  }
  return rows;
}

/** The home image's title block: the owner's name. */
function homeRows(card: HomeCard, width = HOME_BLOCK): Row[] {
  return card.name ? [[{ label: UI.seo.name, width, value: cellValue(card.name, width, LEAD_SIZES) }]] : [];
}

/** The home image's layout: the headline across the sheet, and the title block. */
function homeLayout(card: HomeCard) {
  const rows = homeRows(card);
  const blockTop = OG_HEIGHT - BAND - (rows.length ? blockHeight(rows) : 0);
  const width = OG_WIDTH - LEFT - BAND - INSET;
  const headline = card.headline ? fitText(card.headline, measure('headline', TRACKING), width, HEADLINE_FIT) : null;
  return { rows, width, headline, maxHeight: blockTop - GAP - TOP };
}

/**
 * A project image's layout: the title and subtitle run across the sheet when all of them clear the
 * title block, else they stand in the column beside it.
 */
function projectLayout(card: ProjectCard) {
  const rows = projectRows(card);
  const blockTop = OG_HEIGHT - BAND - blockHeight(rows);
  const lay = (width: number) => {
    const title = fitText(card.title, measure('title', TRACKING), width, TITLE_FIT);
    const subtitle = card.subtitle ? breakLines(card.subtitle, measure('subtitle')(SUBTITLE.size), width) : [];
    const height = title.lines.length * Math.round(title.size * TITLE_LINE) + (subtitle.length ? SUBTITLE_GAP + subtitle.length * SUBTITLE.line : 0);
    return { width, title, subtitle, height };
  };
  const column = lay(OG_WIDTH - BAND - PROJECT_BLOCK - GAP - LEFT);
  const across = lay(OG_WIDTH - LEFT - BAND - INSET);
  const text = TOP + across.height <= blockTop - GAP && across.title.size >= column.title.size ? across : column;
  return { rows, text, maxHeight: OG_HEIGHT - BAND - INSET - TOP };
}

function HomeImage({ card, palette }: { card: HomeCard; palette: Palette }) {
  const { rows, width, headline, maxHeight } = homeLayout(card);
  return (
    <Sheet palette={palette}>
      {headline ? (
        <div style={{ position: 'absolute', left: LEFT, top: TOP, display: 'flex', width, maxHeight, overflow: 'hidden' }}>
          <Lines lines={headline.lines} name="headline" size={headline.size} line={Math.round(headline.size * HEADLINE_LINE)} color={palette.ink} tracking={TRACKING} />
        </div>
      ) : null}
      {rows.length ? <TitleBlock rows={rows} width={HOME_BLOCK} palette={palette} /> : null}
    </Sheet>
  );
}

function ProjectImage({ card, palette }: { card: ProjectCard; palette: Palette }) {
  const { rows, text, maxHeight } = projectLayout(card);
  return (
    <Sheet palette={palette}>
      <div style={{ position: 'absolute', left: LEFT, top: TOP, display: 'flex', flexDirection: 'column', width: text.width, maxHeight, overflow: 'hidden' }}>
        <Lines lines={text.title.lines} name="title" size={text.title.size} line={Math.round(text.title.size * TITLE_LINE)} color={palette.ink} tracking={TRACKING} />
        {text.subtitle.length ? (
          <div style={{ display: 'flex', marginTop: SUBTITLE_GAP }}>
            <Lines lines={text.subtitle} name="subtitle" size={SUBTITLE.size} line={SUBTITLE.line} color={palette.inkDim} />
          </div>
        ) : null}
      </div>
      <TitleBlock rows={rows} width={PROJECT_BLOCK} palette={palette} />
    </Sheet>
  );
}

/** The image's element for next/og. */
export function cardElement(card: Card, palette: Palette) {
  return card.kind === 'home' ? <HomeImage card={card} palette={palette} /> : <ProjectImage card={card} palette={palette} />;
}

/** The faces an image draws with, for its ImageResponse. */
export function cardFaces(card: Card): FaceName[] {
  return card.kind === 'home' ? ['headline', 'mono'] : ['title', 'subtitle', 'mono'];
}

/**
 * Every piece of text an image draws, in drawing order, from the same layout the elements use: the
 * zone marks, the headline or the title and subtitle, then the title block's labels (as drawn, in
 * capitals) and values. The tests read an image's words here rather than from its pixels.
 */
export function drawnText(card: Card): string[] {
  const zone = [...UI.site.zoneColumns, ...UI.site.zoneRows];
  const block = (rows: Row[]) =>
    rows.flatMap((row) => row.flatMap((cell) => [cell.label.toUpperCase(), ...(cell.value?.lines ?? []), ...(cell.scale?.lines ?? [])]));
  if (card.kind === 'home') {
    const { rows, headline } = homeLayout(card);
    return [...zone, ...(headline?.lines ?? []), ...block(rows)];
  }
  const { rows, text } = projectLayout(card);
  return [...zone, ...text.title.lines, ...text.subtitle, ...block(rows)];
}
