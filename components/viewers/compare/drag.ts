/**
 * Dragging the before and after divider: loaded on demand when the viewer comes near the view,
 * so it is never part of a page's first load. Keyboard use needs none of this; the range input
 * in Compare handles it.
 *
 * Mouse and pen: press anywhere on the photo to move the divider there, then drag. Touch: a
 * sideways drag moves the divider and a tap moves it to the tap; an up or down drag scrolls the
 * page and a two-finger pinch zooms it, because the surface keeps `touch-action: pan-y
 * pinch-zoom` (docs/V3_PLAN.md D-70).
 */
export function attachCompareDrag(
  surface: HTMLElement,
  options: { onChange: (percent: number) => void; focusTarget?: HTMLElement | null },
): () => void {
  let active: { id: number; type: string; startX: number; startY: number; moved: boolean } | null =
    null;
  let rect = surface.getBoundingClientRect();

  const percentAt = (clientX: number) => {
    if (rect.width <= 0) return 50;
    const value = ((clientX - rect.left) / rect.width) * 100;
    return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    rect = surface.getBoundingClientRect();
    active = {
      id: event.pointerId,
      type: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    if (event.pointerType !== 'touch') {
      try {
        surface.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone.
      }
      options.onChange(percentAt(event.clientX));
      // Arrow keys work after a click, without showing a focus ring for the mouse.
      options.focusTarget?.focus({ preventScroll: true });
      event.preventDefault();
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!active || active.id !== event.pointerId) return;
    if (active.type === 'touch' && !active.moved) {
      const dx = Math.abs(event.clientX - active.startX);
      const dy = Math.abs(event.clientY - active.startY);
      if (dx < 6 || dx <= dy) return;
      active.moved = true;
      try {
        surface.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone.
      }
    }
    active.moved = true;
    options.onChange(percentAt(event.clientX));
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!active || active.id !== event.pointerId) return;
    const ended = active;
    active = null;
    try {
      surface.releasePointerCapture(event.pointerId);
    } catch {
      // Released already.
    }
    if (ended.type === 'touch' && !ended.moved) {
      const distance = Math.hypot(event.clientX - ended.startX, event.clientY - ended.startY);
      if (distance < 8) options.onChange(percentAt(event.clientX));
    }
  };

  const onPointerCancel = () => {
    active = null;
  };

  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerCancel);
  return () => {
    surface.removeEventListener('pointerdown', onPointerDown);
    surface.removeEventListener('pointermove', onPointerMove);
    surface.removeEventListener('pointerup', onPointerUp);
    surface.removeEventListener('pointercancel', onPointerCancel);
  };
}
