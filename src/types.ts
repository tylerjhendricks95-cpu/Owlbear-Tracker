export interface InitiativeEntry {
  id: string;
  name: string;
  modifier: number;
  roll: number;
  total: number;
}

export interface InitiativeMetadata {
  entries: InitiativeEntry[];
  activeIndex: number;
}

export const METADATA_KEY = "com.tylerjhendricks95-cpu.initiative-tracker/metadata";
