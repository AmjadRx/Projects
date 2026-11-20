'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { LensCursorModule, LensCursorProps } from './lensFollow';

export type LensFollowHandle = {
  /** Mounts the Motion+ Cursor for one follow, at once. */
  start: (props: LensCursorProps) => void;
  /** Takes it away again, at once. */
  stop: () => void;
  /** Takes it away with the next render: from an effect, where React cannot render at once. */
  clear: () => void;
};

/**
 * Where the lens's Motion+ Cursor mounts, for the drawing (PointerLens) and the model
 * (useHeroLens): nothing until a follow starts, then ./LensCursor.tsx with that follow's props,
 * remounted for each follow so its spring starts from the lens. Its own state, so starting or
 * stopping a follow renders this small component and nothing around it.
 *
 * start and stop render at once (flushSync) from the pointer event that asks for them, so the hand
 * from the drawn ring to the Cursor's ring, and back, happens within one frame: call them from
 * event handlers only, never from a render or an effect, where clear is the way.
 */
const LensFollowHost = forwardRef<LensFollowHandle, { cursor: LensCursorModule | null }>(function LensFollowHost({ cursor }, ref) {
  const [follow, setFollow] = useState<{ id: number; props: LensCursorProps } | null>(null);
  const count = useRef(0);

  useImperativeHandle(
    ref,
    () => ({
      start(props) {
        count.current += 1;
        const id = count.current;
        flushSync(() => setFollow({ id, props }));
      },
      stop() {
        flushSync(() => setFollow(null));
      },
      clear() {
        setFollow(null);
      },
    }),
    [],
  );

  if (!cursor || !follow) return null;
  const LensCursor = cursor.default;
  return <LensCursor key={follow.id} {...follow.props} />;
});

export default LensFollowHost;
