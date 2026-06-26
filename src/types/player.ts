interface InventoryItem {
  type: string;
  count: number;
  durability?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}

type InventorySlot = InventoryItem | null;

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
