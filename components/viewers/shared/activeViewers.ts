'use client';

/**
 * At most two 3D viewers render at a time (ARCHITECTURE.md 13A). A viewer claims a slot when its
 * engine starts; when a third claims one, the viewer used least recently is asked to suspend
 * (it unmounts its canvas and shows its poster with a resume button).
 */
const MAX_ACTIVE = 2;

let order: string[] = [];
const suspenders = new Map<string, () => void>();

export function claimViewerSlot(id: string, suspend: () => void): void {
  order = order.filter((other) => other !== id);
  order.push(id);
  suspenders.set(id, suspend);
  while (order.length > MAX_ACTIVE) {
    const victim = order.shift();
    if (victim === undefined) break;
    const callback = suspenders.get(victim);
    suspenders.delete(victim);
    callback?.();
  }
}

/** Marks a viewer as the most recently used (on interaction). */
export function touchViewerSlot(id: string): void {
  if (!order.includes(id)) return;
  order = order.filter((other) => other !== id);
  order.push(id);
}

export function releaseViewerSlot(id: string): void {
  order = order.filter((other) => other !== id);
  suspenders.delete(id);
}
