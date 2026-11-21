'use client';

/**
 * The focal point of a photo (ARCHITECTURE.md 7.3 "image focal point"; 9: images are cropped with
 * the stored focal point). The owner clicks the part of the photo that must stay in view, or
 * drags the crosshair, or focuses the photo and moves the point with the arrow keys (Shift for
 * bigger steps). The value is `{ x, y }`, fractions from 0 to 1 of the width and the height;
 * Reset removes the key, and the site then keeps the center. Three small crops show the effect.
 * A drag or a run of key presses is one undo step (the edits coalesce on the field's id).
 */
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { RotateCcw } from 'lucide-react';
import { objectPosition } from '@/lib/media';
import type { EditOptions } from '../state/store';
import { useFieldId } from '../state/hooks';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { cx } from '../ui/cx';
import styles from './media.module.css';
import { useDisplayAddress } from './services';

export interface Focal {
  x: number;
  y: number;
}

const STEP = 0.01;
const BIG_STEP = 0.1;

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Three decimals: finer than any screen, and short in the stored JSON. */
function round(value: number): number {
  return Math.round(clamp(value) * 1000) / 1000;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export interface FocalPointFieldProps {
  /** The focal key's path ("cover.focal"). */
  path: string;
  /** The photo's address. */
  src: string;
  value: Focal | undefined;
  /** The new point, or undefined to remove the key. */
  onChange: (focal: Focal | undefined, edit?: EditOptions) => void;
}

export function FocalPointField({ path, src, value, onChange }: FocalPointFieldProps) {
  const id = useFieldId(path);
  const edit: EditOptions = { coalesce: id };
  const address = useDisplayAddress(src);
  const box = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const point = value ?? { x: 0.5, y: 0.5 };
  const words = value ? `${percent(point.x)} across, ${percent(point.y)} down` : 'not set, so crops keep the center';

  const setFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const el = box.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    onChange({ x: round((event.clientX - rect.left) / rect.width), y: round((event.clientY - rect.top) / rect.height) }, edit);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    let { x, y } = point;
    switch (event.key) {
      case 'ArrowLeft':
        x -= step;
        break;
      case 'ArrowRight':
        x += step;
        break;
      case 'ArrowUp':
        y -= step;
        break;
      case 'ArrowDown':
        y += step;
        break;
      case 'Home':
        x = 0.5;
        y = 0.5;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange({ x: round(x), y: round(y) }, edit);
  };

  return (
    <Field
      path={path}
      label="Focal point"
      hint="Click the part of the photo that must stay in view when it is cropped, or focus the photo and use the arrow keys (Shift moves further, Home returns to the center)."
      value={value}
    >
      {(control) => (
        <div className={styles.focal}>
          {address ? (
            <div
              {...control}
              ref={box}
              tabIndex={0}
              role="slider"
              aria-label="Focal point"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(point.x * 100)}
              aria-valuetext={words}
              className={styles.focalBox}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                dragging.current = true;
                setFromPointer(event);
              }}
              onPointerMove={(event) => {
                if (dragging.current) setFromPointer(event);
              }}
              onPointerUp={() => {
                dragging.current = false;
              }}
              onPointerCancel={() => {
                dragging.current = false;
              }}
              onKeyDown={onKeyDown}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.focalImg} src={address} alt="" draggable={false} />
              <span
                className={cx(styles.cross, !value && styles.crossUnset)}
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                aria-hidden="true"
              />
            </div>
          ) : (
            <p {...control} className={styles.note}>
              The photo cannot be shown here, so its focal point cannot be set.
            </p>
          )}
          <div className={styles.focalSide}>
            <p className={styles.focalValue}>Focal point: {words}.</p>
            {address ? (
              <div className={styles.crops} aria-hidden="true">
                {(['wide', 'square', 'tall'] as const).map((shape) => (
                  <span key={shape} className={cx(styles.crop, styles[`crop_${shape}`])}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={address} alt="" draggable={false} style={{ objectPosition: objectPosition(point) }} />
                  </span>
                ))}
              </div>
            ) : null}
            <Button size="sm" icon={<RotateCcw size={16} />} disabled={!value} onClick={() => onChange(undefined)}>
              Reset
            </Button>
          </div>
        </div>
      )}
    </Field>
  );
}
