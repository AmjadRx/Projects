/**
 * The admin's building blocks, for every editor (site tabs, projects, media). Read the doc
 * comment of each module for its contract:
 *
 * - inputs.tsx: TextField, TextArea, NumberField, Toggle, Select, CheckboxGroup, SlugField,
 *   UrlField. Each takes `path` (its field path; sets its DOM id and shows its findings), `value`,
 *   and `onChange(value, edit)`; pass `edit` to the store.
 * - Field.tsx: the frame around a custom control, and `useFieldFindings`.
 * - ListEditor.tsx: rows with add, remove, duplicate, move, drag, collapse.
 * - Dialog.tsx, Confirm.tsx: modal dialogs, and `useConfirm()` instead of window.confirm.
 * - Button.tsx, bits.tsx: Button, IconButton, Badge, Notice, Section, PanelHeader, FieldGrid, Kbd.
 * - bind.ts: `useSiteBinding(path)` and `useProjectBinding(key, path)`.
 * - paths.ts, list.ts: immutable reads, writes, and list operations.
 */
export { Button, IconButton, type ButtonProps, type ButtonVariant, type IconButtonProps } from './Button';
export { Badge, FieldGrid, Kbd, Notice, PanelHeader, Section, type NoticeProps, type SectionProps, type Tone } from './bits';
export { Field, findingTargets, useFieldFindings, useFieldStatus, type FieldControlProps, type FieldProps, type FieldStatus } from './Field';
export {
  CheckboxGroup,
  MARKDOWN_HINT,
  NumberField,
  Select,
  SLUG_PATTERN,
  SlugField,
  TextArea,
  TextField,
  Toggle,
  UrlField,
  slugIssue,
  slugifyTyping,
  urlIssue,
  urlKindOf,
  type CheckboxGroupProps,
  type ChoiceOption,
  type InputBaseProps,
  type NumberFieldProps,
  type SelectProps,
  type SlugFieldProps,
  type TextAreaProps,
  type TextFieldProps,
  type ToggleProps,
  type UrlFieldProps,
  type UrlKind,
} from './inputs';
export { ListEditor, type ListEditorProps, type ListRowContext } from './ListEditor';
export { Dialog, type DialogProps } from './Dialog';
export { ConfirmDialog, ConfirmProvider, useConfirm, useOptionalConfirm, type ConfirmDialogProps, type ConfirmFn, type ConfirmOptions } from './Confirm';
export { useProjectBinding, useSiteBinding } from './bind';
export { childPath, getIn, joinPath, parsePath, pathWithin, setIn, updateIn, type PathSegment } from './paths';
export { deepCopy, dropIndex, duplicateItem, insertItem, moveItem, removeItem, replaceItem } from './list';
export { cx } from './cx';
