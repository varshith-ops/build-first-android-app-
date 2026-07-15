import { useReducer, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Entity types
// ─────────────────────────────────────────────────────────────────────────────

export type EntityType = 'asteroid' | 'coin' | 'powerUp';

export interface Entity {
  id: string;
  type: EntityType;
  x: number;
  y: number;
  speed: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Game status
// ─────────────────────────────────────────────────────────────────────────────

export type GameStatus = 'idle' | 'playing' | 'paused' | 'gameOver';

// ─────────────────────────────────────────────────────────────────────────────
// State shape
// ─────────────────────────────────────────────────────────────────────────────

export interface GameState {
  score: number;
  distance: number;
  coins: number;
  highScore: number;
  gameStatus: GameStatus;
  entities: Entity[];
  /**
   * Flips to true for exactly one render when an asteroid collision occurs.
   * ScreenShake watches this and calls dispatch({ type: 'CLEAR_COLLISION' })
   * when its animation completes, resetting it to false.
   */
  justCollided: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action union
// ─────────────────────────────────────────────────────────────────────────────

/** Start a fresh game session; resets ephemeral state but preserves highScore. */
export interface StartGameAction {
  type: 'START_GAME';
}

/**
 * Advance the simulation by one frame.
 * The caller supplies the updated entity positions already computed outside
 * the reducer (e.g. by the physics loop), along with incremental deltas.
 */
export interface TickAction {
  type: 'TICK';
  /** Points earned this tick (usually 0 or 1). */
  scoreDelta: number;
  /** Metres travelled this tick. */
  distanceDelta: number;
  /** Updated entity list (positions already advanced by physics). */
  entities: Entity[];
}

/** Add a newly spawned entity to the world. */
export interface SpawnEntityAction {
  type: 'SPAWN_ENTITY';
  entity: Entity;
}

/** Remove one entity by its id (e.g. after it exits the screen or is destroyed). */
export interface RemoveEntityAction {
  type: 'REMOVE_ENTITY';
  entityId: string;
}

/**
 * Record the outcome of a collision detected externally.
 * The reducer updates score / coins based on collisionType.
 * Actual collision geometry is computed by a separate utility — not here.
 */
export interface CollisionAction {
  type: 'COLLISION';
  collisionType: 'asteroid' | 'coin' | 'powerUp';
  /** Id of the entity involved (will be removed from the entity list). */
  entityId: string;
  /** Optional extra score awarded for this collision (e.g. combo multiplier already applied). */
  scoreBonus: number;
}

/** Pause a running game. No-op if not currently playing. */
export interface PauseAction {
  type: 'PAUSE';
}

/** Resume a paused game. No-op if not currently paused. */
export interface ResumeAction {
  type: 'RESUME';
}

/** Transition to the gameOver screen. Triggers highScore comparison inside reducer. */
export interface GameOverAction {
  type: 'GAME_OVER';
}

/** Overwrite the stored high score (called after persistence layer resolves). */
export interface SetHighScoreAction {
  type: 'SET_HIGH_SCORE';
  highScore: number;
}

/** Return to idle state (main menu). Clears all ephemeral state. */
export interface ResetAction {
  type: 'RESET';
}

/**
 * Called by ScreenShake after its impact animation completes (~300 ms).
 * Resets justCollided so the next asteroid hit can re-trigger the effect.
 */
export interface ClearCollisionAction {
  type: 'CLEAR_COLLISION';
}

/**
 * Hydrates the reducer with persisted data loaded from AsyncStorage.
 * Dispatched once on mount after the async read completes.
 * Does NOT block the initial render — state starts at INITIAL_STATE (0/0)
 * and updates to the stored values within ~50 ms.
 */
export interface LoadPersistedAction {
  type: 'LOAD_PERSISTED';
  highScore: number;
  coins:     number;
}

export type GameAction =
  | StartGameAction
  | TickAction
  | SpawnEntityAction
  | RemoveEntityAction
  | CollisionAction
  | PauseAction
  | ResumeAction
  | GameOverAction
  | SetHighScoreAction
  | ResetAction
  | ClearCollisionAction
  | LoadPersistedAction;

// ─────────────────────────────────────────────────────────────────────────────
// Initial state
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_STATE: GameState = {
  score:        0,
  distance:     0,
  coins:        0,
  highScore:    0,
  gameStatus:   'idle',
  entities:     [],
  justCollided: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Pure reducer  — zero side effects
// ─────────────────────────────────────────────────────────────────────────────

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    // ── START_GAME ──────────────────────────────────────────────────────────
    case 'START_GAME':
      return {
        ...INITIAL_STATE,
        // Carry forward the high score so it shows on-screen from frame 0.
        highScore: state.highScore,
        gameStatus: 'playing',
      };

    // ── TICK ────────────────────────────────────────────────────────────────
    case 'TICK': {
      if (state.gameStatus !== 'playing') return state;
      const newScore    = state.score    + action.scoreDelta;
      const newDistance = state.distance + action.distanceDelta;
      return {
        ...state,
        score:        newScore,
        distance:     newDistance,
        entities:     action.entities,
        justCollided: false,          // auto-clear each tick as safety net
        highScore: newScore > state.highScore ? newScore : state.highScore,
      };
    }

    // ── SPAWN_ENTITY ────────────────────────────────────────────────────────
    case 'SPAWN_ENTITY':
      if (state.gameStatus !== 'playing') return state;
      return {
        ...state,
        entities: [...state.entities, action.entity],
      };

    // ── REMOVE_ENTITY ───────────────────────────────────────────────────────
    case 'REMOVE_ENTITY':
      return {
        ...state,
        entities: state.entities.filter((e) => e.id !== action.entityId),
      };

    // ── COLLISION ───────────────────────────────────────────────────────────
    case 'COLLISION': {
      if (state.gameStatus !== 'playing') return state;

      // Remove the collided entity regardless of type.
      const remaining = state.entities.filter((e) => e.id !== action.entityId);

      switch (action.collisionType) {
        case 'coin': {
          return {
            ...state,
            entities: remaining,
            coins: state.coins + 1,
          };
        }
        case 'asteroid': {
          const newScore = state.score + action.scoreBonus;
          return {
            ...state,
            entities:     remaining,
            score:        newScore,
            justCollided: true,       // triggers ScreenShake
            highScore: newScore > state.highScore ? newScore : state.highScore,
          };
        }
        case 'powerUp': {
          // PowerUp effects (shield, rapid fire…) live in the UI layer.
          // The reducer only removes the entity and applies any score bonus.
          const newScore = state.score + action.scoreBonus;
          return {
            ...state,
            entities: remaining,
            score:     newScore,
            highScore: newScore > state.highScore ? newScore : state.highScore,
          };
        }
        default:
          // Exhaustive check — TypeScript will error if a new collisionType is
          // added without handling it here.
          return state;
      }
    }

    // ── PAUSE ────────────────────────────────────────────────────────────────
    case 'PAUSE':
      if (state.gameStatus !== 'playing') return state;
      return { ...state, gameStatus: 'paused' };

    // ── RESUME ───────────────────────────────────────────────────────────────
    case 'RESUME':
      if (state.gameStatus !== 'paused') return state;
      return { ...state, gameStatus: 'playing' };

    // ── GAME_OVER ────────────────────────────────────────────────────────────
    case 'GAME_OVER': {
      if (state.gameStatus === 'gameOver') return state;
      const finalHighScore =
        state.score > state.highScore ? state.score : state.highScore;
      return {
        ...state,
        gameStatus: 'gameOver',
        highScore:  finalHighScore,
        entities:   [],          // Clear world on death.
      };
    }

    // ── SET_HIGH_SCORE ───────────────────────────────────────────────────────
    case 'SET_HIGH_SCORE':
      return {
        ...state,
        highScore: action.highScore > state.highScore
          ? action.highScore
          : state.highScore,
      };

    // ── CLEAR_COLLISION ──────────────────────────────────────────────────────
    case 'CLEAR_COLLISION':
      return { ...state, justCollided: false };

    // ── RESET ────────────────────────────────────────────────────────────────
    case 'RESET':
      return {
        ...INITIAL_STATE,
        highScore: state.highScore,   // Preserve across sessions.
      };

    // ── LOAD_PERSISTED ──────────────────────────────────────────────────────
    // Only meaningful in 'idle' — never overwrite in-progress game data.
    case 'LOAD_PERSISTED':
      if (state.gameStatus !== 'idle') return state;
      return {
        ...state,
        highScore: Math.max(state.highScore, action.highScore),
        coins:     Math.max(state.coins,     action.coins),
      };

    // Exhaustive default — guarantees type safety for future actions.
    default: {
      // `action` is `never` here if all cases are handled.
      const _exhaustiveCheck: never = action;
      return state;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export interface UseGameStateReturn {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
}

/**
 * useGameState
 *
 * Single source of truth for all game data.
 *
 * Storage integration:
 *  • On mount: loads highScore + coins from AsyncStorage and hydrates state
 *    via LOAD_PERSISTED — non-blocking, UI shows 0 until the read resolves.
 *  • On GAME_OVER: persists highScore (if new record) and total coin count.
 *
 * @example
 * const { state, dispatch } = useGameState();
 * dispatch({ type: 'START_GAME' });
 */
export function useGameState(): UseGameStateReturn {
  const [state, dispatch] = useReducer(gameReducer, INITIAL_STATE);

  // ── Hydrate from storage on mount ───────────────────────────────────────────
  // Import is deferred inside the effect so the module itself never imports
  // AsyncStorage at the top level (avoids initialisation order issues during
  // fast-refresh and Jest environments where storage may not be mocked yet).
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { getHighScore, getCoins } = await import('../utils/storage');
      const [highScore, coins] = await Promise.all([getHighScore(), getCoins()]);

      if (!cancelled) {
        dispatch({ type: 'LOAD_PERSISTED', highScore, coins });
      }
    })();

    return () => { cancelled = true; };
  // Empty deps: run once on mount, clean up on unmount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist on game-over ───────────────────────────────────────────────────
  // Runs only when gameStatus transitions to 'gameOver'. Writes are
  // fire-and-forget — persistence failure is silent and non-fatal.
  useEffect(() => {
    if (state.gameStatus !== 'gameOver') return;

    (async () => {
      const { setHighScore, setCoins } = await import('../utils/storage');
      await Promise.all([
        setHighScore(state.highScore),
        setCoins(state.coins),
      ]);
    })();
  // Deliberately depend on the specific values being persisted so the effect
  // only re-fires when they change, not on every state update.
  }, [state.gameStatus, state.highScore, state.coins]);

  return { state, dispatch };
}
