import questsConfig from './quests.json';
import { QuestsData } from '../types/data';

export const QuestsRegistry: QuestsData = questsConfig as unknown as QuestsData;
