// Accumulate real, visible playback time without counting pauses, stalls or seeking.
export function createPlaybackCounter() {
  let previous: { media: number; wall: number; rate: number } | null = null, seconds = 0, sent = false;
  return {
    reset() { previous = null; },
    tick(media: number, wall: number, rate: number, playing: boolean) {
      if (sent || !playing || !Number.isFinite(media) || !Number.isFinite(wall) || !Number.isFinite(rate) || rate <= 0) { previous = null; return false; }
      if (previous) {
        const elapsed = (wall - previous.wall) / 1000, delta = media - previous.media;
        if (elapsed > 0 && elapsed <= 3 && delta > 0 && delta <= elapsed * Math.max(rate, previous.rate) + 0.75) seconds += Math.min(elapsed, delta / Math.max(rate, previous.rate));
      }
      previous = { media, wall, rate };
      if (seconds >= 5) { sent = true; return true; }
      return false;
    },
  };
}
