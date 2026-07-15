import { useEffect, useRef, useCallback } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  INSTALLATION REQUIRED
//
// expo-audio is NOT included in the default Expo SDK 57 template.
// Before using this hook, run:
//
//   npx expo install expo-audio
//
// This installs the version pinned to your SDK (expo-audio ~0.4.0 for SDK 57).
// No babel.config.js changes are needed.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A require()-ed local audio asset, e.g. require('../../assets/sounds/hit.mp3') */
export type AudioSource = Parameters<typeof useAudioPlayer>[0];

export interface UseSoundOptions {
  /** If true, the sound loops indefinitely until stop() is called. Default false. */
  loop?: boolean;
  /** Playback volume 0–1. Default 1. */
  volume?: number;
}

export interface UseSoundReturn {
  /**
   * Start playback from the beginning.
   * Safe to call before the player has finished loading — the call is a no-op
   * until the player is ready, so fire-and-forget is fine.
   */
  play: () => void;
  /**
   * Stop playback and seek back to the start.
   * No-op if the player is not currently playing.
   */
  stop: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useSound
 *
 * Thin wrapper around expo-audio's `useAudioPlayer` that exposes a simple
 * `play()` / `stop()` interface suitable for game sound effects and BGM.
 *
 * The underlying AudioPlayer is managed by expo-audio's hook — it is created
 * once when the component mounts and automatically released when it unmounts,
 * so there are no manual load/unload calls and no memory leaks.
 *
 * @param source  - A require()'d audio file, e.g. require('../../assets/sounds/hit.mp3')
 * @param options - { loop?, volume? }
 *
 * @example — one-shot SFX
 * const { play } = useSound(require('../../assets/sounds/hit.mp3'));
 * // ... in a collision handler:
 * play();
 *
 * @example — looping BGM
 * const bgm = useSound(require('../../assets/sounds/bgm.mp3'), { loop: true });
 * useEffect(() => {
 *   if (isPlaying) bgm.play(); else bgm.stop();
 * }, [isPlaying]);
 */
export function useSound(
  source: AudioSource,
  options: UseSoundOptions = {},
): UseSoundReturn {
  const { loop = false, volume = 1 } = options;

  // expo-audio manages the player lifecycle via this hook.
  // Passing `loop` here configures it at construction time.
  const player = useAudioPlayer(source, /* bufferDuration */ undefined);

  // Apply volume and loop config whenever they change.
  useEffect(() => {
    player.volume = volume;
    player.loop   = loop;
  }, [player, volume, loop]);

  // ── play ──────────────────────────────────────────────────────────────────
  const play = useCallback(() => {
    try {
      // Seek to the beginning so rapid consecutive calls replay from start
      // (important for SFX that may be triggered faster than their duration).
      player.seekTo(0);
      player.play();
    } catch {
      // Swallow errors gracefully — audio is non-critical to gameplay.
      // Errors can occur if the audio file is missing or the device is muted.
    }
  }, [player]);

  // ── stop ──────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    try {
      player.pause();
      player.seekTo(0);
    } catch {
      // Swallow — same rationale as play().
    }
  }, [player]);

  return { play, stop };
}

// ─────────────────────────────────────────────────────────────────────────────
// Specialised BGM hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useBackgroundMusic
 *
 * Wraps useSound with loop:true and automatically starts/stops playback
 * in response to an `isPlaying` boolean — ideal for driving BGM from
 * game status without wiring useEffect in every screen.
 *
 * @param source    - require()'d audio file
 * @param isPlaying - Start music when true, stop when false
 * @param volume    - Optional volume override (default 0.5 for BGM)
 */
export function useBackgroundMusic(
  source: AudioSource,
  isPlaying: boolean,
  volume = 0.5,
): void {
  const { play, stop } = useSound(source, { loop: true, volume });

  useEffect(() => {
    if (isPlaying) {
      play();
    } else {
      stop();
    }
    // stop() on unmount (e.g. navigating away mid-game)
    return () => { stop(); };
  }, [isPlaying, play, stop]);
}
