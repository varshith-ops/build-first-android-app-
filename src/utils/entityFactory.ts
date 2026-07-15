import { Entity, EntityType } from '../hooks/useGameState';

// ─────────────────────────────────────────────────────────────────────────────
// Speed ranges per entity type (pixels per frame at 60 fps baseline)
// ─────────────────────────────────────────────────────────────────────────────

const SPEED_RANGES: Record<EntityType, { min: number; max: number }> = {
  asteroid: { min: 3.5, max: 7.0 },
  coin:     { min: 2.0, max: 3.5 },
  powerUp:  { min: 1.5, max: 2.5 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Visual footprint per entity type (used to keep entity within game bounds)
// ─────────────────────────────────────────────────────────────────────────────

const ENTITY_WIDTH: Record<EntityType, number> = {
  asteroid: 50,
  coin:     18,
  powerUp:  28,
};

// ─────────────────────────────────────────────────────────────────────────────
// ID counter — monotonically increasing so IDs never collide even when
// Date.now() returns the same value across two consecutive calls.
// ─────────────────────────────────────────────────────────────────────────────

let _counter = 0;
const nextId = (type: EntityType): string =>
  `${type}_${Date.now()}_${++_counter}`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Returns a random x position that keeps the entity's leading edge within
 * [0, gameAreaWidth].
 */
function randomX(type: EntityType, gameAreaWidth: number): number {
  const entityW = ENTITY_WIDTH[type];
  const maxX = Math.max(0, gameAreaWidth - entityW);
  return Math.random() * maxX;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createEntity
 *
 * Produces a new Entity with:
 *  - A stable, unique `id` (type-prefixed for readability in dev tools)
 *  - A random `x` position bounded within [0, gameAreaWidth - entityWidth]
 *  - `y` placed just above the visible screen (negative, so it enters smoothly)
 *  - A `speed` randomised within the type-appropriate range
 *
 * @param type          - 'asteroid' | 'coin' | 'powerUp'
 * @param gameAreaWidth - Width of the play area in pixels (e.g. screen width)
 * @returns             A fully initialised Entity ready to be added to state
 *
 * @example
 * const asteroid = createEntity('asteroid', Dimensions.get('window').width);
 * dispatch({ type: 'SPAWN_ENTITY', entity: asteroid });
 */
export function createEntity(
  type: EntityType,
  gameAreaWidth: number,
): Entity {
  const { min, max } = SPEED_RANGES[type];
  return {
    id:    nextId(type),
    type,
    x:     randomX(type, gameAreaWidth),
    y:     -(ENTITY_WIDTH[type] + 10), // start just above the visible area
    speed: randomInRange(min, max),
  };
}
