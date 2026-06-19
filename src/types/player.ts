export interface InventoryItem {
  type: string;
  count: number;
  durability?: number;
  metadata?: Record<string, any>;
}

export type InventorySlot = InventoryItem | null;

export interface PlayerState {
  version: number;
  forceTeleportPos: [number, number, number] | null;
  isStreamingTerrain: boolean;
  texture: string;
  activeHotbarIndex: number;
  coins: number;
  
  // UI states
  isInventoryOpen: boolean;
  isShopOpen: boolean;
  isCraftingTableOpen: boolean;
  isSkillTreeOpen: boolean;
  isQuestJournalOpen: boolean;
  isHeartCoreOpen: boolean;
  isLunarAnchorOpen: boolean;
  isAstrolabeOpen: boolean;
  isWarpDriveUIOpen: boolean;
  isBuildMode: boolean;
  isShipyardUIOpen: boolean;

  activeChestId: string | null;
  activeFurnaceId: string | null;
  shipyardCorePos: [number, number, number] | null;

  // Actions will be typed fully when useStore is typed
}
