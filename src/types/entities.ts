export interface EntityData {
  id: string;
  type: string;
  position: [number, number, number];
  rotation: [number, number, number];
  velocity?: [number, number, number];
  health?: number;
  metadata?: Record<string, any>;
}
