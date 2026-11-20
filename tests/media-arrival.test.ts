// @vitest-environment jsdom
/**
 * A photo arriving in its well (components/viewers/image/arrival.tsx; motion sheet 6.4: "The photo
 * fades in over the well when it has decoded"). The phases of usePhotoArrival as the photo loads,
 * and the loading well, which stays whole under the photo while the photo fades in over it and
 * goes only once the photo's fade and its own are over.
 */
import { act, createElement as h, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARRIVAL_SETTLE_MS, LoadingWell, usePhotoArrival, type PhotoArrival } from '../components/viewers/image/arrival';

/** A stand-in for next/image's <img>, as far along as the test says. */
function image(complete: boolean, naturalWidth: number): HTMLImageElement {
  const img = document.createElement('img');
  Object.defineProperty(img, 'complete', { configurable: true, get: () => complete });
  Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => naturalWidth });
  return img;
}

let container: HTMLDivElement;
let root: Root;
let arrival: PhotoArrival;

/** A well as the viewers draw it: the loading well, from the arrival of the photo in `img`. */
function Well({ img, active }: { img: HTMLImageElement; active: boolean }) {
  const ref = useRef<HTMLImageElement>(img);
  arrival = usePhotoArrival(ref, active);
  return h(LoadingWell, { arrival });
}

const draw = (img: HTMLImageElement, active = true) => act(() => root.render(h(Well, { img, active })));
const well = () => container.querySelector<HTMLElement>('.mm-load');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('usePhotoArrival and the loading well', () => {
  it('waits over the well, fades in with the well whole under it, and only then lets the well go', () => {
    draw(image(false, 0));
    expect(arrival).toMatchObject({ phase: 'wait', waiting: true, underlay: true, attr: 'wait' });
    expect(well()?.dataset.arrive).toBe('wait');
    expect(well()?.querySelector('.ar-ph__bar')).not.toBeNull();

    // Decoded: the photo fades in over the well, which is still there, line and all.
    act(() => arrival.onLoad());
    expect(arrival).toMatchObject({ phase: 'show', waiting: false, underlay: true, attr: 'show' });
    expect(well()?.dataset.arrive).toBe('show');
    expect(well()?.querySelector('.ar-ph__bar')).not.toBeNull();

    act(() => vi.advanceTimersByTime(ARRIVAL_SETTLE_MS - 1));
    expect(arrival.phase).toBe('show');
    expect(well()).not.toBeNull();

    // Both fades are over: the photo is in, and the well is gone.
    act(() => vi.advanceTimersByTime(1));
    expect(arrival).toMatchObject({ phase: 'done', waiting: false, underlay: false, attr: undefined });
    expect(well()).toBeNull();
  });

  it('leaves a photo that is already painting as it is, with no well', () => {
    draw(image(true, 1600));
    expect(arrival).toMatchObject({ phase: 'idle', underlay: false, attr: undefined });
    expect(well()).toBeNull();
    act(() => arrival.onLoad());
    expect(arrival.phase).toBe('idle');
  });

  it('draws no well and hides nothing while motion is not allowed', () => {
    draw(image(false, 0), false);
    expect(arrival.phase).toBe('idle');
    expect(well()).toBeNull();
  });

  it('shows the photo as it is at once when motion stops mid-fade, and when the file fails', () => {
    const img = image(false, 0);
    draw(img);
    act(() => arrival.onLoad());
    expect(arrival.phase).toBe('show');
    draw(img, false);
    expect(arrival.phase).toBe('idle');
    expect(well()).toBeNull();

    draw(img, true);
    expect(arrival.phase).toBe('wait');
    act(() => arrival.onError());
    expect(arrival.phase).toBe('idle');
    expect(well()).toBeNull();
    // Its timer was dropped with the fade: nothing changes later.
    act(() => vi.advanceTimersByTime(ARRIVAL_SETTLE_MS));
    expect(arrival.phase).toBe('idle');
  });
});
