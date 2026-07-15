import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Entity, EntityType } from '../hooks/useGameState';
import Asteroid, { AsteroidProps } from './Asteroid';
import Coin from './Coin';
import PowerUp from './PowerUp';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface EntityRendererProps {
  entities: Entity[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-entity visual switcher
// ─────────────────────────────────────────────────────────────────────────────

function renderEntity(entity: Entity): React.ReactNode {
  const position = {
    position: 'absolute' as const,
    left: entity.x,
    top:  entity.y,
  };

  switch (entity.type) {
    case 'asteroid':
      return (
        <View key={entity.id} style={position}>
          <Asteroid entityId={entity.id} />
        </View>
      );

    case 'coin':
      return (
        <View key={entity.id} style={position}>
          <Coin entityId={entity.id} />
        </View>
      );

    case 'powerUp':
      return (
        <View key={entity.id} style={position}>
          <PowerUp entityId={entity.id} />
        </View>
      );

    default: {
      // Exhaustiveness guard — TypeScript will error here if a new EntityType
      // is added without a corresponding case above.
      const _unreachable: never = entity.type;
      return null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EntityRenderer
 *
 * Maps over the `entities` array and delegates rendering to the correct
 * visual component based on `entity.type`.  Each entity is absolutely
 * positioned at (entity.x, entity.y) relative to the enclosing play area.
 *
 * No movement logic lives here — this is a pure presentation layer.
 * The parent is responsible for updating entity positions each frame and
 * passing the updated array as a new prop reference.
 *
 * @example
 * <View style={StyleSheet.absoluteFill}>
 *   <EntityRenderer entities={state.entities} />
 * </View>
 */
export default function EntityRenderer({ entities }: EntityRendererProps): React.ReactElement {
  return (
    <>
      {entities.map(renderEntity)}
    </>
  );
}
