# Host Control Commands

This document outlines the in-game chat commands available exclusively to the world's Host (the player who created the server) or promoted operators. These commands are authoritative and executed over the PeerJS WebRTC network.

## Using Commands

Commands must be typed into the chat window and prefixed with a forward slash (`/`).
Guests who attempt to use these commands without permission will receive an error feedback message.

## Available Commands

### 1. `/kick <player>`
Forcefully disconnects a guest player from the current game session.
- **Usage:** `/kick PlayerName`
- **Logic:** The `useNetworkStore` searches WebRTC connections for the given player name/ID, closes the connection (`conn.close()`), and broadcasts a system message.

### 2. `/time set <value>`
Changes the time of day in the dynamic sky rendering.
- **Usage:** `/time set morning`, `/time set noon`, `/time set night`, or a numeric value (e.g., `/time set 12000`).
- **Logic:** Updates the global `worldTime` in `createWorldSlice` which drives the `DynamicSky.jsx` sun/moon positioning.

### 3. `/give <player> <item_id> [amount]`
Spawns an item directly into the target player's inventory or drops it at their feet if full.
- **Usage:** `/give PlayerName diamond_sword 1`
- **Logic:** Updates local inventory (for Host) or dispatches an inventory update packet to the guest client.

### 4. `/tp <player>`
Teleports the host to the target player, or teleports the target player to the host.
- **Usage:** `/tp PlayerName`
- **Logic:** Overrides the rigid body translation in the Rapier physics engine. Anti-cheat rubber-banding is temporarily bypassed for the teleportation frame.

### 5. `/gamemode <survival|creative|adventure>`
Changes the player's gameplay mode (affecting damage calculations, build limits, etc.).
- **Usage:** `/gamemode survival` or `/gamemode creative`
- **Logic:** Mutates player slice state and broadcasts the state change to all clients.

### 6. `/weather <clear|rain>`
Forces environmental weather shifts.
- **Usage:** `/weather clear` or `/weather rain`
- **Logic:** Triggers weather state shifts in the `EnvironmentStore` and broadcasts synchronized time/weather packages.

### 7. `/ship`
Spawns the default prefab voxel ship at the calling player's location.
- **Usage:** `/ship`
- **Logic:**
  - Instantiates a fresh ship voxel matrix offset vertically by +15 blocks above the player's coordinate.
  - Composes the default ship `setShipTransform` configuration.
  - Packs the ship voxel layout buffer into an RLE (Run-Length Encoded) byte stream and broadcasts it via `SHIP_BUFFER_SYNC` to synchronize all guests.

### 8. `/op <player>`
Promotes a guest player to server Operator, granting them administrative command permissions.
- **Usage:** `/op PlayerName`
- **Logic:** Inserts the target player's connection ID into the `mods` list and broadcasts promotion feedback.

### 9. `/deop <player>`
Revokes Operator privileges from a promoted guest player.
- **Usage:** `/deop PlayerName`
- **Logic:** Removes the player's ID from the `mods` list.

## Network Security

Commands are processed authoritatively by the Host inside `networkActions.js` via the `processCommandIntent` handler. When guests issue a command, a `COMMAND_INTENT` package is routed to the Host, who explicitly validates the sender's Operator (`isOp`) status before executing the instruction, maintaining complete networking security.
