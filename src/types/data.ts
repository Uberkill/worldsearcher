export interface BiomeDefinition {
  surface: string;
  subsurface: string;
  roughness: number;
  structures: string[];
  flora: string[];
  fauna: string[];
}

export type BiomeRegistryData = Record<string, BiomeDefinition>;

export interface LootDrop {
  id: string;
  chance: number;
  min: number;
  max: number;
}

export interface LootTable {
  rolls: number;
  drops: LootDrop[];
}

export type LootRegistryData = Record<string, LootTable>;

export interface QuestObjective {
  type: string;
  target: string;
  amount: number;
}

export interface QuestRewardItem {
  texture: string;
  count: number;
}

export interface QuestRewards {
  data?: number;
  coins?: number;
  items?: QuestRewardItem[];
}

export interface QuestDefinition {
  id: string;
  syncLevel?: number;
  title: string;
  description: string;
  objectives: QuestObjective[];
  rewards: QuestRewards;
}

export interface QuestsData {
  main_quests: QuestDefinition[];
  side_quests_pool: QuestDefinition[];
}

export interface SkillDefinition {
  id: string;
  name: string;
  category: string;
  cost: number;
  icon: string;
  description: string;
  prerequisites: string[];
  modifiers: Record<string, number>;
}

export interface SkillsData {
  skills: SkillDefinition[];
}
