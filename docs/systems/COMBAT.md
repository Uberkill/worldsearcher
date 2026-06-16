# Combat and Entity Systems

## 1. Host-Authoritative Combat (`HostCombat.jsx`)

To prevent client-side hacking and ensure fair gameplay, all combat and weapon logic is processed by the Host and synchronized over the network.

When a guest player clicks to attack, their client sends an attack intent containing `weaponId`, `dir` (direction), `origin`, and `timestamp`. The Host's `HostCombat.jsx` component evaluates the queue of pending attacks.

### Deterministic Physics Tick
All combat logic is evaluated strictly within a **20Hz Fixed Physics Tick** (`useBeforePhysicsStep`). This guarantees that hitscan raycasts and projectile spawns hit exactly where the enemy physically exists in the Rapier physics world, completely immune to visual interpolation tearing or monitor refresh rate discrepancies.

### Hitscan Weapons

- **Ranged (e.g., Gauss Rifle):** The host casts a Rapier ray (`world.castRay`) along the player's view vector. If it hits an entity or block, an area-of-effect damage event is triggered precisely at the impact point.
- **Melee (e.g., Swords, Pickaxes):** Instead of a thin raycast that might miss small enemies, melee weapons create a massive "cleave" area-of-effect directly in front of the player. This guarantees strikes on tiny entities like Muck Pigs even if the crosshair isn't perfectly aligned.

### Projectile Weapons

- **Bows / Guns:** The host creates a physical `RigidBody` (ball collider) moving at a specific velocity with slight gravity.
- **Resolution:** A network event (`SPAWN_PROJECTILE`) is broadcast so all clients can render deterministic visual tracers. Once the physical collider strikes a target on the host, a `PROJECTILE_IMPACT` event triggers damage and localized visual effects.
- **Memory Management:** Physical projectiles are aggressively garbage-collected after 5 seconds to prevent physics engine lag.

## 2. Entity Management (`SwarmManager.jsx`)

World Search utilizes a centralized `SwarmManager.jsx` rather than allowing independent enemies to manage their own lifecycles.

- **Terrain Scanning:** Entities spawn adaptively over procedurally generated hills and valleys to avoid spawning inside solid blocks.
- **Entity State:** AI pathfinding and target acquisition are processed on the Host. The resulting delta coordinates are pushed to clients at a fixed tick rate to update visual models smoothly.

## 3. Grapple Gun (`Tether.jsx`)

The Grapple Gun utilizes physics impulses combined with visual tethering.

- The player fires a raycast to find a suitable solid anchor block.
- `Tether.jsx` renders a dynamic instanced cylinder stretching from the player's viewmodel barrel to the target anchor.
- The player's physics controller applies continuous pulling force towards the anchor point until released.
