import type { CompendiumType, Visibility } from "@contracts/constants";
import type { CompendiumCardDto } from "@contracts/compendium";

/** Русские подписи и краткие сводки для карточек компедиума. */

export const COMPENDIUM_TYPE_LABELS: Record<CompendiumType, string> = {
  spell: "Заклинание",
  item: "Предмет",
  monster: "Монстр",
  character: "Персонаж",
  species: "Вид",
  class: "Класс",
  feat: "Черта",
  background: "Предыстория",
};

export const COMPENDIUM_VISIBILITY_LABELS: Record<Visibility, string> = {
  private: "Приватная",
  shared: "Общая",
};

/**
 * Подписи значений enum-полей. Ключ — `${type}.${fieldKey}` (у разных типов
 * бывают одноимённые поля с разными значениями, напр. category у item/feat).
 */
const OPTION_LABELS: Record<string, Record<string, string>> = {
  "spell.school": {
    abjuration: "Ограждение",
    conjuration: "Вызов",
    divination: "Прорицание",
    enchantment: "Очарование",
    evocation: "Воплощение",
    illusion: "Иллюзия",
    necromancy: "Некромантия",
    transmutation: "Преобразование",
  },
  "spell.components": {
    verbal: "Вербальный",
    somatic: "Соматический",
    material: "Материальный",
  },
  "item.category": {
    weapon: "Оружие",
    armor: "Доспех",
    gear: "Снаряжение",
    tool: "Инструмент",
    consumable: "Расходуемый",
    treasure: "Ценность",
    other: "Прочее",
  },
  "item.rarity": {
    none: "Нет",
    common: "Обычный",
    uncommon: "Необычный",
    rare: "Редкий",
    veryRare: "Очень редкий",
    legendary: "Легендарный",
    artifact: "Артефакт",
  },
  "monster.size": {
    tiny: "Крошечный",
    small: "Маленький",
    medium: "Средний",
    large: "Большой",
    huge: "Огромный",
    gargantuan: "Гигантский",
  },
  "species.size": {
    small: "Маленький",
    medium: "Средний",
  },
  "feat.category": {
    origin: "Черта происхождения",
    general: "Общая черта",
    fightingStyle: "Боевой стиль",
    epicBoon: "Эпический дар",
    other: "Прочая",
  },
};

/** Подписи вложенных ключей (abilities, элементы списков и т.п.). */
export const COMPENDIUM_NESTED_LABELS: Record<string, string> = {
  str: "СИЛ",
  dex: "ЛОВ",
  con: "ТЕЛ",
  int: "ИНТ",
  wis: "МДР",
  cha: "ХАР",
  name: "Название",
  text: "Текст",
};

export function compendiumOptionLabel(
  type: CompendiumType,
  fieldKey: string,
  value: string,
): string {
  return (
    OPTION_LABELS[`${type}.${fieldKey}`]?.[value] ??
    COMPENDIUM_NESTED_LABELS[value] ??
    value
  );
}

function asRecord(data: unknown): Record<string, unknown> {
  return (data ?? {}) as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Однострочная сводка карточки для списков (без обращения к DOM). */
export function compendiumCardSummary(card: CompendiumCardDto): string {
  const d = asRecord(card.data);
  switch (card.type) {
    case "spell": {
      const level = num(d.level);
      const circle = level === 0 ? "Заговор" : level !== null ? `${level} круг` : "";
      const school = compendiumOptionLabel("spell", "school", str(d.school));
      return [circle, school].filter(Boolean).join(" · ");
    }
    case "item": {
      const category = compendiumOptionLabel("item", "category", str(d.category));
      const rarity = str(d.rarity);
      const rarityLabel =
        rarity && rarity !== "none"
          ? compendiumOptionLabel("item", "rarity", rarity)
          : "";
      return [category, rarityLabel].filter(Boolean).join(" · ");
    }
    case "monster": {
      const size = compendiumOptionLabel("monster", "size", str(d.size));
      const ac = num(d.armorClass);
      const hp = num(d.hitPoints);
      return [
        size,
        str(d.creatureType),
        ac !== null ? `КБ ${ac}` : "",
        hp !== null ? `ХП ${hp}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "character": {
      const level = num(d.level);
      return [
        str(d.className),
        level !== null ? `${level} ур.` : "",
        str(d.species),
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "species": {
      const speed = num(d.speed);
      return [
        compendiumOptionLabel("species", "size", str(d.size)),
        speed !== null ? `Скорость ${speed} фт.` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "class": {
      const hitDie = num(d.hitDie);
      return hitDie !== null ? `Кость хитов: к${hitDie}` : "";
    }
    case "feat":
      return compendiumOptionLabel("feat", "category", str(d.category));
    case "background":
      return str(d.feat) ? `Черта: ${str(d.feat)}` : "";
    default:
      return "";
  }
}
