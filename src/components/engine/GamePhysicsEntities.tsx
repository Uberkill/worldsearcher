import { Player } from '../Player';
import { Cubes } from '../Cubes';
import { Enemies } from '../Enemies';
import { Bullets } from '../Bullets';
import { Lasers } from '../Lasers';
import { Tether } from '../Tether';
import { DroppedItems } from '../DroppedItems';
import { Tombstones } from '../Tombstones';
import { HostCombat } from '../HostCombat';
import { MultiplayerManager } from '../MultiplayerManager';
import { TransitManager } from '../TransitManager';
import { ShipPhysics } from '../ShipPhysics';
import { BlockInteraction } from '../BlockInteraction';

export const GamePhysicsEntities = () => (
  <>
    <Player />
    <Cubes />
    <Enemies />
    <Bullets />
    <Lasers />
    <Tether />
    <DroppedItems />
    <Tombstones />
    <HostCombat />
    <MultiplayerManager />
    <TransitManager />
    <ShipPhysics />
    <BlockInteraction />
  </>
);
