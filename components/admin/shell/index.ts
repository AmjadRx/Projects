/**
 * The admin shell's pieces that the editors use (site tabs, projects, media):
 *
 * - `StatusPanel`: the connection-status panel; the Settings tab renders it.
 * - `WarningsPanel` and `useWarnings`: the guard-rail list (every file with a filter, or one file).
 * - `FindingsList`: findings as a list, each linked to its field.
 * - `useAdminRoute()`: `{ tab, project, go(tab, project?) }` from the URL hash
 *   ("#tab=projects&project=raven"); the projects editor reads `project` and calls `go`.
 * - `useRevealOpen(path)` and `useCollapsible(path)`: open a collapsed group when a reveal
 *   targets a field inside it (see ./reveal.ts).
 * - `useChangedFiles()`: the paths a save would write or remove.
 * - `RevertFileButton`: "Revert this file to published" for one content file (ARCHITECTURE.md 7.5).
 *
 * The Shell itself (./Shell.tsx) is imported by AdminApp only, so the editors can import this
 * file without an import cycle.
 */
export { StatusPanel } from './StatusPanel';
export { WarningsPanel, useWarnings, type WarningsPanelProps } from './WarningsPanel';
export { FindingsList, type FindingsListProps } from './FindingsList';
export { formatRoute, parseRoute, useAdminRoute, type AdminRoute } from './route';
export { RevertFileButton, workingData, type RevertFileButtonProps } from './RevertFile';
export { bringIntoView, revealFieldPath, revealInProgress, useCollapsible, useRevealOpen, useRevealTarget, type RevealTarget } from './reveal';
export { useChangedFiles } from './changes';
export { StatusText, type StatusTone } from './StatusText';
export { UndoRedo } from './UndoRedo';
export { isTextEntry, shortcutOf, useShortcuts, type ShortcutAction } from './keys';
export { plural, shortSha } from './format';
