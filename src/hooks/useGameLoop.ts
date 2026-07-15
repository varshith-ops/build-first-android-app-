import { useEffect, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callback invoked once per animation frame while the loop is running.
 *
 * @param deltaTime - Elapsed time in **seconds** since the previous frame.
 *   Clamped to [0, MAX_DELTA] so a tab losing focus and regaining it
 *   (which can produce a very large gap) does not cause a physics explosion.
 */
export type TickCallback = (deltaTime: number) => void;

export interface UseGameLoopOptions {
  /** The function to call every animation frame. */
  onTick: TickCallback;
  /**
   * Whether the loop should be running.
   * Set to `true` to start, `false` to pause/stop.
   * The animation frame is cancelled immediately when this transitions to false.
   */
  isRunning: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum deltaTime (seconds) forwarded to onTick in a single frame.
 * Without this cap, returning from a backgrounded tab could produce a
 * delta of several seconds and cause entities to teleport.
 *
 * 100 ms ≈ 6 skipped frames at 60 fps — a safe upper bound.
 */
const MAX_DELTA_S = 0.1;

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useGameLoop
 *
 * Runs a `requestAnimationFrame` loop and calls `onTick(deltaTime)` every
 * frame while `isRunning` is `true`.
 *
 * Responsibilities of this hook (tick mechanism only):
 *  ✓ Start / stop the rAF loop based on `isRunning`
 *  ✓ Calculate frame-accurate deltaTime in seconds
 *  ✓ Clamp deltaTime to avoid physics spikes after tab focus loss
 *  ✓ Cancel the pending frame on unmount and when `isRunning` goes false
 *  ✓ Always read the latest `onTick` without restarting the loop (ref pattern)
 *
 * Responsibilities NOT in this hook:
 *  ✗ Movement, spawning, collision, scoring (belong in callers / other utils)
 *  ✗ setInterval / setTimeout for the core loop
 *
 * @example
 * useGameLoop({
 *   isRunning: gameStatus === 'playing',
 *   onTick: (dt) => {
 *     moveEntities(dt);
 *     checkCollisions();
 *   },
 * });
 */
export function useGameLoop({ onTick, isRunning }: UseGameLoopOptions): void {
  /**
   * Always hold the latest onTick reference so the rAF closure never
   * captures a stale version, without needing to restart the loop when
   * onTick changes between renders.
   */
  const onTickRef = useRef<TickCallback>(onTick);
  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  useEffect(() => {
    if (!isRunning) return;

    // raf handle — used for cancellation
    let rafId: number;

    // Timestamp of the previous frame (milliseconds, as provided by rAF)
    let previousTimestamp: number | null = null;

    const loop: FrameRequestCallback = (timestamp: number) => {
      // On the very first frame there is no previous timestamp, so delta = 0.
      const rawDelta =
        previousTimestamp === null ? 0 : timestamp - previousTimestamp;

      previousTimestamp = timestamp;

      // Convert ms → s and apply the safety cap.
      const deltaTime = Math.min(rawDelta / 1000, MAX_DELTA_S);

      // Invoke the latest tick callback — never a stale closure.
      onTickRef.current(deltaTime);

      // Schedule the next frame.  We store the new handle so the cleanup
      // function always cancels the most-recently-scheduled frame.
      rafId = requestAnimationFrame(loop);
    };

    // Kick off the loop.
    rafId = requestAnimationFrame(loop);

    // Cleanup: runs when isRunning flips to false, onTick identity changes
    // (unlikely but safe), or the component unmounts.
    return () => {
      cancelAnimationFrame(rafId);
      // Reset so the next start treats its first frame as delta = 0.
      previousTimestamp = null;
    };
  }, [isRunning]); // onTick intentionally omitted — read via ref above
}
