import skillsConfig from './skills.json';
import { SkillsData } from '../types/data';

export const SkillsRegistry: SkillsData = skillsConfig as unknown as SkillsData;
