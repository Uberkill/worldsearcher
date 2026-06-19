export interface ShipData {
  id: string;
  ownerId: string;
  corePosition: [number, number, number];
  blocks: Record<string, number>; // Local position string to block ID
  isFlying: boolean;
  velocity?: [number, number, number];
  rotation?: [number, number, number, number]; // Quaternion
}
