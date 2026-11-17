/**
 * One player at a time: when a video, an audio file, or an embedded player starts, every other
 * player on the page pauses.
 */
const players = new Map<string, () => void>();

/** Registers a player's pause function. Returns the function that removes it. */
export function registerPlayer(id: string, pause: () => void): () => void {
  players.set(id, pause);
  return () => {
    if (players.get(id) === pause) players.delete(id);
  };
}

/** Pauses every registered player except this one. */
export function claimPlayback(id: string): void {
  players.forEach((pause, other) => {
    if (other !== id) pause();
  });
}
