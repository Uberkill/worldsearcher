# Game Modes

World Search features a unified Game Mode system managed within `createPlayerSlice.js`. The active game mode dictates block interactions, physics, and entity aggression.

## Available Modes

### 1. Survival (Default)

The standard gameplay experience.

- **Inventory:** Players must gather blocks and craft items. Block placement consumes inventory count.
- **Health:** Players take damage from falls, combat, and environmental hazards (lava).
- **Death:** When health reaches 0, a `Tombstone` is generated with the player's dropped items. The `DeathScreen` appears, and the player can respawn at their bed or the world origin.

### 2. Creative

A mode for unlimited building and exploration.

- **Inventory:** Unlimited block placement. The hotbar relies on an infinite item source.
- **Health:** Invincible (`if (get().gameMode?.toLowerCase() === 'creative') return;` blocks all incoming damage in the player slice).
- **Flight:** Double-tapping jump enables omni-directional free-flight, bypassing standard gravity constraints in the Rapier physics controller.
- **Anti-Cheat:** Host allows extreme vertical velocities (un-clamped vertical falls/ascends) for creative players.

### 3. Hardcore

A punishing mode for experienced players.

- **Mechanics:** Identical to Survival mode but with strict death penalties.
- **Death:** Prevents standard respawning (`if (get().gameMode?.toLowerCase() === 'hardcore') return;`). Depending on server configuration, it forces a spectator state or kicks the player from the world.

## Changing Game Modes

Game modes are currently bound to the world initialization state or altered via future host commands. Code logic checks the `gameMode` string directly (case-insensitive) before applying damage, dropping items, or deducting blocks from the inventory.
