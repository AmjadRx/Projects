/**
 * The Open Graph images, drawn as a Blueprint sheet (ARCHITECTURE.md 5, "Also new";
 * DESIGN_DIRECTION.md 2.4, place 6, 4, and 5.1): the frame with its zone marks (1 to 8 across the
 * top, A to F down the side, as components/site/SheetFrame.tsx draws them), the drawing grid, the
 * heat rule under the top of the frame, and the title block in the bottom right corner. The home
 * image sets the headline; a project image sets its title and subtitle and fills the title block,
 * with the maturity scale in the ramp. Text and lines only: no photograph and no generated picture.
 *
 * Everything stays on the sheet whatever the content's length (the admin sets no limit): a title
 * block that would rise too high steps its type down, then widens; a title and subtitle that would
 * run past the text's area step down together, as does the home headline. Only text far longer
 * than any real field, past the smallest step, is cut short with an ellipsis (the alt text still
 * reads it whole). cardLayout() reports where everything went, for the tests.
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
import { breakLines, clampLines, fitText, wholeSize, type Fitted } from './text';

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
/** The text's area: inset from the frame on the left, the right, and the foot, under the heat rule. */
const TEXT_W = OG_WIDTH - LEFT - BAND - INSET;
const TEXT_H = OG_HEIGHT - BAND - INSET - TOP;
/** The gap between the text and the title block. */
const GAP = 48;

/** The drawing grid, as app/sheet.css draws it (--grid-step-minor and --grid-step-major). */
const MINOR = 8;
const MAJOR = 64;
/** Zone ticks and marks, as app/sheet.css 9 draws them. */
const TICK = 6;
const MARK_SIZE = 13;

/**
 * The title block's widths, narrowest first: a project's block widens only when its rows do not fit
 * at its smallest type. Its fixed end cells (SHEET, REV) keep their widths.
 */
const PROJECT_BLOCKS = [456, 520, 584];
const HOME_BLOCK = 380;
const SHEET_CELL = 140;
const REV_CELL = 170;
/** The highest a project's title block may rise: a band's width clear of the heat rule. */
const BLOCK_TOP = BAND + 1 + HEAT + BAND;
/** The highest the home image's block may rise: the frame's middle, so the headline keeps the upper half. */
const HOME_BLOCK_TOP = BAND + FRAME_H / 2;
/** Title block cell padding, and the gap under a label. */
const CELL_X = 18;
const CELL_Y = 13;
const LABEL_GAP = 3;

/** The title block's labels in px. */
const LABEL = { size: 14, line: 20, tracking: 0.08 };
/**
 * The title block's type in px, largest first: the lead value (the project's title or the owner's
 * name), the other values, and the maturity note. A block whose rows do not fit steps all three down
 * together, one level at a time; within a level, a cell steps further down only to keep a long word
 * whole.
 */
const LEAD_SIZES = [26, 24, 22, 20, 18, 16];
const VALUE_SIZES = [20, 18, 16, 15, 14];
const NOTE_SIZES = [19, 18, 17, 16, 15, 14];
const LEVELS = LEAD_SIZES.length;
/** A scale's sizes from a level down. */
const from = (sizes: readonly number[], level: number) => sizes.slice(Math.min(level, sizes.length - 1));

/** Headline and title: the pages' tracking (-0.02em) and line heights (0.98 and 1.02). */
const TRACKING = -0.02;
const HEADLINE_LINE = 0.98;
const TITLE_LINE = 1.02;
/**
 * The headline's and title's largest size and line count, and their smallest size at each step. A
 * title steps down together with its subtitle: step k sets the subtitle at SUBTITLE_SIZES[k].
 */
const HEADLINE_FIT = { max: 104, maxLines: 3 };
const HEADLINE_MINS = [56, 48, 40, 32];
const TITLE_FIT = { max: 120, maxLines: 3 };
const TITLE_MINS = [44, 40, 36, 32, 28];
const SUBTITLE_SIZES = [28, 26, 24, 22, 20];
const SUBTITLE_GAP = 18;

/** The maturity scale's cells (app/sheet.css 12). */
const SCALE_H = 16;
const SCALE_GAP = 4;

/** Line heights: the title block's values, the maturity note, the subtitle, the headline, the title. */
const valueLine = (size: number) => Math.round(size * 1.33);
const noteLine = (size: number) => Math.round(size * 1.42);
const subtitleLine = (size: number) => Math.round(size * 1.4);
const headlineLine = (size: number) => Math.round(size * HEADLINE_LINE);
const titleLine = (size: number) => Math.round(size * TITLE_LINE);

function measure(name: FaceName, tracking = 0) {
  return (size: number) => (text: string) => face(name).width(text, size, tracking * size);
}

/** Text as set: where it came from (to cut it shorter if it must be), its face, size, line height, and lines. */
interface SetText {
  text: string;
  face: FaceName;
  size: number;
  line: number;
  lines: string[];
}

/** Sets `text` in `width` at the first of `sizes` at which every word fits whole. */
function setText(text: string, name: FaceName, width: number, sizes: readonly number[], lineHeight: (size: number) => number): SetText {
  const at = measure(name);
  const size = wholeSize(text, at, width, sizes);
  return { text, face: name, size, line: lineHeight(size), lines: breakLines(text, at(size), width) };
}

/** The same text cut short to at most `maxLines` lines in `width`. */
function cutShort(set: SetText, width: number, maxLines: number): { set: SetText; clamped: boolean } {
  const { lines, clamped } = clampLines(set.text, measure(set.face)(set.size), width, maxLines);
  return { set: { ...set, lines }, clamped };
}

const height = (set: SetText | null) => (set ? set.lines.length * set.line : 0);

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

/** A title block cell: its label, and either its value's lines or a maturity scale with its note. */
interface Cell {
  label: string;
  width: number;
  value?: SetText;
  scale?: { step: number; note: SetText };
}

/** A title block row: one cell across, or a cell and an end cell (SHEET, REV) beside it. */
type Row = Cell[];

/** The width a cell's text is set in. */
const inner = (cell: Pick<Cell, 'width'>) => cell.width - 2 * CELL_X;

/** A value set in B612 Mono for a cell of `width`. */
function cellValue(text: string, width: number, sizes: readonly number[]): SetText {
  return setText(text, 'mono', inner({ width }), sizes, valueLine);
}

/** The text a cell sets: its value, or its maturity note. */
const cellText = (cell: Cell): SetText => cell.value ?? cell.scale!.note;

function cellHeight(cell: Cell): number {
  const body = cell.scale ? 8 + SCALE_H + 8 + height(cell.scale.note) : LABEL_GAP + height(cell.value ?? null);
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
          <MaturityCells step={cell.scale.step} width={inner(cell)} palette={palette} />
          <div style={{ display: 'flex', marginTop: 8 }}>
            <Lines lines={cell.scale.note.lines} name={cell.scale.note.face} size={cell.scale.note.size} line={cell.scale.note.line} color={palette.inkDim} />
          </div>
        </div>
      ) : cell.value ? (
        <div style={{ display: 'flex', marginTop: LABEL_GAP }}>
          <Lines lines={cell.value.lines} name={cell.value.face} size={cell.value.size} line={cell.value.line} color={palette.ink} />
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

/** A project's title block at a width and a type level, as components/sheet/TitleBlock.tsx lays it out; a field with no value has no cell. */
function projectRows(card: ProjectCard, width: number, level: number): Row[] {
  const values = from(VALUE_SIZES, level);
  const sheet = `${card.sheet} ${UI.titleBlock.of.toUpperCase()} ${card.sheets}`;
  const rows: Row[] = [
    [
      { label: UI.titleBlock.project, width: width - SHEET_CELL, value: cellValue(card.title, width - SHEET_CELL, from(LEAD_SIZES, level)) },
      { label: UI.titleBlock.sheet, width: SHEET_CELL, value: cellValue(sheet, SHEET_CELL, values) },
    ],
  ];
  if (card.role) rows.push([{ label: UI.titleBlock.role, width, value: cellValue(card.role, width, values) }]);
  if (card.dates) rows.push([{ label: UI.titleBlock.dates, width, value: cellValue(card.dates, width, values) }]);
  if (card.rev) {
    rows.push([
      { label: UI.titleBlock.status, width: width - REV_CELL, value: cellValue(card.status, width - REV_CELL, values) },
      { label: UI.titleBlock.rev, width: REV_CELL, value: cellValue(card.rev, REV_CELL, values) },
    ]);
  } else {
    rows.push([{ label: UI.titleBlock.status, width, value: cellValue(card.status, width, values) }]);
  }
  if (card.maturity) {
    const note = setText(card.maturity.label, 'subtitle', inner({ width }), from(NOTE_SIZES, level), noteLine);
    rows.push([{ label: UI.maturity.label, width, scale: { step: card.maturity.step, note } }]);
  }
  return rows;
}

/** The home image's title block at a width and a type level: the owner's name. */
function homeRows(card: HomeCard, width: number, level: number): Row[] {
  return card.name ? [[{ label: UI.seo.name, width, value: cellValue(card.name, width, from(LEAD_SIZES, level)) }]] : [];
}

interface Block {
  rows: Row[];
  width: number;
  height: number;
  /** The type level the rows are set at: 0 is the designed size. */
  level: number;
  clamped: boolean;
}

/** Cuts the tallest cell short by a line at a time until the rows fit `maxHeight`. */
function clampRows(rows: Row[], maxHeight: number): { rows: Row[]; clamped: boolean } {
  const out = rows.map((row) => [...row]);
  let clamped = false;
  while (blockHeight(out) > maxHeight) {
    let target: [number, number] | null = null;
    for (let r = 0; r < out.length; r += 1) {
      for (let c = 0; c < out[r].length; c += 1) {
        if (cellText(out[r][c]).lines.length < 2) continue;
        if (!target || cellHeight(out[r][c]) > cellHeight(out[target[0]][target[1]])) target = [r, c];
      }
    }
    if (!target) break;
    const cell = out[target[0]][target[1]];
    const set = cellText(cell);
    const cut = cutShort(set, inner(cell), set.lines.length - 1);
    clamped ||= cut.clamped;
    out[target[0]][target[1]] = cell.scale ? { ...cell, scale: { ...cell.scale, note: cut.set } } : { ...cell, value: cut.set };
  }
  return { rows: out, clamped };
}

/**
 * The first title block, at the narrowest of `widths` and then the largest type level, whose rows
 * fit `maxHeight`; past every width and level, the widest at the smallest type, cut short to fit.
 */
function fitBlock(rowsAt: (width: number, level: number) => Row[], widths: readonly number[], maxHeight: number): Block {
  for (const width of widths) {
    for (let level = 0; level < LEVELS; level += 1) {
      const rows = rowsAt(width, level);
      const h = blockHeight(rows);
      if (h <= maxHeight) return { rows, width, height: h, level, clamped: false };
    }
  }
  const width = widths[widths.length - 1];
  const { rows, clamped } = clampRows(rowsAt(width, LEVELS - 1), maxHeight);
  return { rows, width, height: blockHeight(rows), level: LEVELS - 1, clamped };
}

/** A project's title and subtitle in a column of `width`, and the height they take. */
interface ProjectText {
  width: number;
  title: Fitted;
  subtitle: SetText | null;
  height: number;
  clamped: boolean;
}

/**
 * The title and subtitle in a column of `width` and at most `maxHeight`: at the first step where
 * the title fits (lib/og/text.ts fitText) above the subtitle at that step's size. Past the last
 * step, the title keeps the room the subtitle's first line leaves, and the subtitle the rest.
 */
function projectText(card: ProjectCard, width: number, maxHeight: number): ProjectText {
  const titleAt = measure('title', TRACKING);
  const subtitleAt = (size: number) => (card.subtitle ? setText(card.subtitle, 'subtitle', width, [size], subtitleLine) : null);
  const below = (subtitle: SetText | null) => (subtitle ? SUBTITLE_GAP + height(subtitle) : 0);
  for (let k = 0; k < TITLE_MINS.length; k += 1) {
    const subtitle = subtitleAt(SUBTITLE_SIZES[k]);
    const fit = { ...TITLE_FIT, min: TITLE_MINS[k], maxHeight: maxHeight - below(subtitle), lineHeight: titleLine };
    const title = fitText(card.title, titleAt, width, fit);
    if (title) return { width, title, subtitle, height: title.lines.length * titleLine(title.size) + below(subtitle), clamped: false };
  }
  const size = TITLE_MINS[TITLE_MINS.length - 1];
  const sub = subtitleAt(SUBTITLE_SIZES[SUBTITLE_SIZES.length - 1]);
  const reserve = sub ? SUBTITLE_GAP + sub.line : 0;
  const title = clampLines(card.title, titleAt(size), width, Math.floor((maxHeight - reserve) / titleLine(size)));
  const titleHeight = title.lines.length * titleLine(size);
  const subtitle = sub ? cutShort(sub, width, Math.floor((maxHeight - titleHeight - SUBTITLE_GAP) / sub.line)) : null;
  return {
    width,
    title: { size, lines: title.lines },
    subtitle: subtitle?.set ?? null,
    height: titleHeight + below(subtitle?.set ?? null),
    clamped: title.clamped || Boolean(subtitle?.clamped),
  };
}

/** The home headline across the text's area, at most `maxHeight`, stepping down as a title does. */
function headlineText(text: string, maxHeight: number): { fitted: Fitted; height: number; clamped: boolean } {
  const at = measure('headline', TRACKING);
  for (const min of HEADLINE_MINS) {
    const fitted = fitText(text, at, TEXT_W, { ...HEADLINE_FIT, min, maxHeight, lineHeight: headlineLine });
    if (fitted) return { fitted, height: fitted.lines.length * headlineLine(fitted.size), clamped: false };
  }
  const size = HEADLINE_MINS[HEADLINE_MINS.length - 1];
  const { lines, clamped } = clampLines(text, at(size), TEXT_W, Math.floor(maxHeight / headlineLine(size)));
  return { fitted: { size, lines }, height: lines.length * headlineLine(size), clamped };
}

/** The home image's layout: the headline across the sheet, above the title block. */
function homeLayout(card: HomeCard) {
  const block = card.name ? fitBlock((width, level) => homeRows(card, width, level), [HOME_BLOCK], OG_HEIGHT - BAND - HOME_BLOCK_TOP) : null;
  const blockTop = block ? OG_HEIGHT - BAND - block.height : OG_HEIGHT - BAND;
  const headline = card.headline ? headlineText(card.headline, Math.min(TEXT_H, blockTop - GAP - TOP)) : null;
  return { block, headline };
}

/**
 * A project image's layout: the title block fitted first, then the title and subtitle, which run
 * across the sheet when all of them clear the block, else stand in the column beside it.
 */
function projectLayout(card: ProjectCard) {
  const block = fitBlock((width, level) => projectRows(card, width, level), PROJECT_BLOCKS, OG_HEIGHT - BAND - BLOCK_TOP);
  const blockTop = OG_HEIGHT - BAND - block.height;
  const column = projectText(card, OG_WIDTH - BAND - block.width - GAP - LEFT, TEXT_H);
  const across = projectText(card, TEXT_W, TEXT_H);
  const text = !across.clamped && TOP + across.height <= blockTop - GAP && across.title.size >= column.title.size ? across : column;
  return { block, text };
}

function HomeImage({ card, palette }: { card: HomeCard; palette: Palette }) {
  const { block, headline } = homeLayout(card);
  return (
    <Sheet palette={palette}>
      {headline ? (
        <div style={{ position: 'absolute', left: LEFT, top: TOP, display: 'flex', width: TEXT_W }}>
          <Lines lines={headline.fitted.lines} name="headline" size={headline.fitted.size} line={headlineLine(headline.fitted.size)} color={palette.ink} tracking={TRACKING} />
        </div>
      ) : null}
      {block ? <TitleBlock rows={block.rows} width={block.width} palette={palette} /> : null}
    </Sheet>
  );
}

function ProjectImage({ card, palette }: { card: ProjectCard; palette: Palette }) {
  const { block, text } = projectLayout(card);
  return (
    <Sheet palette={palette}>
      <div style={{ position: 'absolute', left: LEFT, top: TOP, display: 'flex', flexDirection: 'column', width: text.width }}>
        <Lines lines={text.title.lines} name="title" size={text.title.size} line={titleLine(text.title.size)} color={palette.ink} tracking={TRACKING} />
        {text.subtitle ? (
          <div style={{ display: 'flex', marginTop: SUBTITLE_GAP }}>
            <Lines lines={text.subtitle.lines} name="subtitle" size={text.subtitle.size} line={text.subtitle.line} color={palette.inkDim} />
          </div>
        ) : null}
      </div>
      <TitleBlock rows={block.rows} width={block.width} palette={palette} />
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

/** A rectangle on the image, in px from its top left corner. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where an image's layout must keep things, for the tests: the frame, the heat rule, and the text's area. */
export const SHEET_AREAS = {
  frame: { left: BAND, top: BAND, width: FRAME_W, height: FRAME_H },
  heat: { left: BAND + 1, top: BAND + 1, width: FRAME_W - 2, height: HEAT },
  text: { left: LEFT, top: TOP, width: TEXT_W, height: TEXT_H },
  /** The highest a project's title block, and the home image's, may rise. */
  blockTop: BLOCK_TOP,
  homeBlockTop: HOME_BLOCK_TOP,
  /** The least room between the text and the title block. */
  gap: GAP,
} as const satisfies Record<string, Box | number>;

export interface CardLayout {
  /** The headline, or the title and subtitle: their column, and the height their lines take. */
  text: Box | null;
  /** The title block. */
  block: Box | null;
  /** The title block's type level (0 is the designed size) and its lead value's size. */
  level: number;
  leadSize: number | null;
  /** True when some text was cut short with an ellipsis, which only text far past any real field's length needs. */
  clamped: boolean;
}

const blockBox = (block: Block): Box => ({ left: OG_WIDTH - BAND - block.width, top: OG_HEIGHT - BAND - block.height, width: block.width, height: block.height });

/** Where an image's text and title block go, from the same layout the elements are drawn from. */
export function cardLayout(card: Card): CardLayout {
  if (card.kind === 'home') {
    const { block, headline } = homeLayout(card);
    return {
      text: headline ? { left: LEFT, top: TOP, width: TEXT_W, height: headline.height } : null,
      block: block ? blockBox(block) : null,
      level: block?.level ?? 0,
      leadSize: block ? block.rows[0][0].value!.size : null,
      clamped: Boolean(block?.clamped || headline?.clamped),
    };
  }
  const { block, text } = projectLayout(card);
  return {
    text: { left: LEFT, top: TOP, width: text.width, height: text.height },
    block: blockBox(block),
    level: block.level,
    leadSize: block.rows[0][0].value!.size,
    clamped: block.clamped || text.clamped,
  };
}

/**
 * Every piece of text an image draws, in drawing order, from the same layout the elements use: the
 * zone marks, the headline or the title and subtitle, then the title block's labels (as drawn, in
 * capitals) and values. The tests read an image's words here rather than from its pixels.
 */
export function drawnText(card: Card): string[] {
  const zone = [...UI.site.zoneColumns, ...UI.site.zoneRows];
  const block = (rows: Row[]) => rows.flatMap((row) => row.flatMap((cell) => [cell.label.toUpperCase(), ...cellText(cell).lines]));
  if (card.kind === 'home') {
    const { block: home, headline } = homeLayout(card);
    return [...zone, ...(headline?.fitted.lines ?? []), ...block(home?.rows ?? [])];
  }
  const { block: project, text } = projectLayout(card);
  return [...zone, ...text.title.lines, ...(text.subtitle?.lines ?? []), ...block(project.rows)];
}
