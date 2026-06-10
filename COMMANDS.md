# Host Control Commands

This document outlines the in-game chat commands available exclusively to the world's Host (the player who created the server). These commands are authoritative and executed over the PeerJS WebRTC network.

## Using Commands

Commands must be typed into the chat window and prefixed with a forward slash (`/`).
Guests who attempt to use these commands will receive an error message: `"You do not have permission to use admin commands."`

## Available Commands

### 1. `/kick <player>`

Forcefully disconnects a guest player from the current game session.

- **Usage:** `/kick PlayerName`
- **Logic:** The `useNetworkStore` searches the current WebRTC connections for the given metadata player ID, explicitly closes their connection (`conn.close()`), and broadcasts a system message indicating the player was kicked. You cannot kick yourself.

### 2. `/time set <value>`

Changes the time of day in the dynamic sky rendering.

- **Usage:** `/time set morning`, `/time set noon`, `/time set night`, or a numeric value (e.g. `/time set 12000`).
- **Logic:** Updates the global `worldTime` in `createWorldSlice` which drives the `DynamicSky.jsx` sun/moon positioning and directional lighting.

### 3. `/give <player> <item_id> [amount]`

Spawns an item directly into the target player's inventory or drops it at their feet if full.

- **Usage:** `/give PlayerName diamond_sword 1`
- **Logic:** If the target is the host, it updates local inventory. If the target is a guest, a dedicated network event is sent to that specific peer to update their local `PlayerSlice`.

### 4. `/tp <player>`

Teleports the host to the target player, or teleports the target player to the host (depending on argument order).

- **Usage:** `/tp PlayerName`
- **Logic:** Overrides the rigid body translation of the target player in the Rapier physics engine. Anti-cheat rubber-banding is temporarily disabled for the teleportation tick to prevent snapping back.

## Network Security

Commands are handled server-side (on the Host's machine) inside `useNetworkStore.js` via the `handleCommandIntent` function. Guests can send a `COMMAND_INTENT` packet, but the Host evaluates the sender's ID before taking any action.
