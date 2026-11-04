import type { AbilityKey, ProficiencyRank } from "@contracts/characters";

/** Русские подписи и форматирование листа (не компоненты — см. fast refresh). */

export const ABILITY_LABELS: Record<AbilityKey, string> = {
  str: "СИЛ",
  dex: "ЛОВ",
  con: "ТЕЛ",
  int: "ИНТ",
  wis: "МДР",
  cha: "ХАР",
};

export const SKILL_LABELS = {
  acrobatics: "Акробатика",
  animalHandling: "Уход за животными",
  arcana: "Магия",
  athletics: "Атлетика",
  deception: "Обман",
  history: "История",
  insight: "Проницательность",
  intimidation: "Запугивание",
  investigation: "Расследование",
  medicine: "Медицина",
  nature: "Природа",
  perception: "Восприятие",
  performance: "Выступление",
  persuasion: "Убеждение",
  religion: "Религия",
  sleightOfHand: "Ловкость рук",
  stealth: "Скрытность",
  survival: "Выживание",
} as const;

export const RANK_LABELS: Record<ProficiencyRank, string> = {
  none: "—",
  proficient: "Владение",
  expertise: "Экспертиза",
};

/** Форматированный производный показатель (+3 / -1) для модификаторов. */
export function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}
