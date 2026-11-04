import { Plus, Trash2 } from "lucide-react";
import {
  abilityKeys,
  abilityModifier,
  proficiencyBonus,
  skillAbilities,
  skillBonus,
  skillKeys,
  type AbilityKey,
  type CharacterSheetData,
  type CharacterSheetPatch,
  type ProficiencyRank,
} from "@contracts/characters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NumberField, SheetField, TextField } from "./fields";
import { ABILITY_LABELS, RANK_LABELS, SKILL_LABELS, formatSigned } from "./labels";

export interface SheetTabProps {
  sheet: CharacterSheetData;
  /** Применить частичный патч секции и отметить лист изменённым. */
  patch: (p: CharacterSheetPatch) => void;
}

/* ------------------------- Вкладка 1: Характеристики ------------------------ */

export function AbilitiesTab({ sheet, patch }: SheetTabProps) {
  const level = sheet.identity.level;
  const prof = proficiencyBonus(level);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <TextField
          label="Класс"
          value={sheet.identity.className}
          maxLength={80}
          onChange={(className) => patch({ identity: { className } })}
        />
        <TextField
          label="Подкласс"
          value={sheet.identity.subclass}
          maxLength={80}
          onChange={(subclass) => patch({ identity: { subclass } })}
        />
        <TextField
          label="Вид"
          value={sheet.identity.species}
          maxLength={80}
          onChange={(species) => patch({ identity: { species } })}
        />
        <TextField
          label="Предыстория"
          value={sheet.identity.background}
          maxLength={80}
          onChange={(background) => patch({ identity: { background } })}
        />
        <TextField
          label="Мировоззрение"
          value={sheet.identity.alignment}
          maxLength={80}
          onChange={(alignment) => patch({ identity: { alignment } })}
        />
        <TextField
          label="Игрок"
          value={sheet.identity.playerName}
          maxLength={120}
          onChange={(playerName) => patch({ identity: { playerName } })}
        />
        <div data-testid="identity-level">
          <NumberField
            label="Уровень"
            value={level}
            min={1}
            max={20}
            onChange={(lvl) => patch({ identity: { level: lvl } })}
          />
        </div>
        <NumberField
          label="Опыт"
          value={sheet.identity.experiencePoints}
          min={0}
          max={10_000_000}
          onChange={(experiencePoints) => patch({ identity: { experiencePoints } })}
        />
        <SheetField label="Бонус мастерства (производный)">
          <div className="flex h-7 items-center">
            <Badge
              variant="secondary"
              className="text-xs"
              data-testid="proficiency-bonus"
            >
              {formatSigned(prof)}
            </Badge>
          </div>
        </SheetField>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {abilityKeys.map((key) => {
          const score = sheet.abilities[key];
          return (
            <div
              key={key}
              className="rounded-md border p-2 text-center"
              data-testid={`ability-card-${key}`}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {ABILITY_LABELS[key]}
              </div>
              <div
                className="my-1 text-lg font-semibold"
                data-testid={`ability-mod-${key}`}
              >
                {formatSigned(abilityModifier(score))}
              </div>
              <NumberField
                label="Значение"
                value={score}
                min={1}
                max={30}
                onChange={(v) => patch({ abilities: { [key]: v } })}
              />
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Модификаторы и бонус мастерства вычисляются автоматически по правилам
        редакции 2024; всё остальное вводится вручную.
      </p>
    </div>
  );
}

/* ---------------------- Вкладка 2: Навыки и спасброски ---------------------- */

export function SkillsTab({ sheet, patch }: SheetTabProps) {
  const level = sheet.identity.level;
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <div>
        <h3 className="mb-1 text-xs font-semibold">Спасброски</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-7 text-xs">Характеристика</TableHead>
              <TableHead className="h-7 w-16 text-center text-xs">Влад.</TableHead>
              <TableHead className="h-7 w-14 text-right text-xs">Бонус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {abilityKeys.map((key) => {
              const rank = sheet.saves[key];
              const bonus = skillBonus(sheet.abilities[key], rank, level);
              return (
                <TableRow key={key}>
                  <TableCell className="py-1 text-xs">{ABILITY_LABELS[key]}</TableCell>
                  <TableCell className="py-1 text-center">
                    <Checkbox
                      checked={rank === "proficient"}
                      onCheckedChange={(checked) =>
                        patch({ saves: { [key]: checked ? "proficient" : "none" } })
                      }
                    />
                  </TableCell>
                  <TableCell className="py-1 text-right text-xs font-medium">
                    {formatSigned(bonus)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold">Навыки</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-7 text-xs">Навык</TableHead>
              <TableHead className="h-7 w-28 text-xs">Степень</TableHead>
              <TableHead className="h-7 w-14 text-right text-xs">Бонус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skillKeys.map((key) => {
              const ability = skillAbilities[key];
              const rank = sheet.skills[key];
              const bonus = skillBonus(sheet.abilities[ability], rank, level);
              return (
                <TableRow key={key}>
                  <TableCell className="py-1 text-xs">
                    {SKILL_LABELS[key]}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {ABILITY_LABELS[ability]}
                    </span>
                  </TableCell>
                  <TableCell className="py-1">
                    <Select
                      value={rank}
                      onValueChange={(v) =>
                        patch({ skills: { [key]: v as ProficiencyRank } })
                      }
                    >
                      <SelectTrigger className="ui-hover h-6 w-28 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(RANK_LABELS) as ProficiencyRank[]).map((r) => (
                          <SelectItem key={r} value={r} className="text-xs">
                            {RANK_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="py-1 text-right text-xs font-medium">
                    {formatSigned(bonus)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ---------------------------- Вкладка 3: Заклинания ------------------------- */

export function SpellsTab({ sheet, patch }: SheetTabProps) {
  const spellcasting = sheet.spellcasting;
  const setSlots = (idx: number, part: Partial<{ total: number; used: number }>) =>
    patch({
      spellcasting: {
        slots: spellcasting.slots.map((s, i) => (i === idx ? { ...s, ...part } : s)),
      },
    });
  const setSpell = (
    idx: number,
    part: Partial<(typeof spellcasting.spells)[number]>,
  ) =>
    patch({
      spellcasting: {
        spells: spellcasting.spells.map((s, i) => (i === idx ? { ...s, ...part } : s)),
      },
    });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SheetField label="Базовая характеристика">
          <Select
            value={spellcasting.ability || "none"}
            onValueChange={(v) =>
              patch({ spellcasting: { ability: v === "none" ? "" : (v as AbilityKey) } })
            }
          >
            <SelectTrigger className="ui-hover h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">—</SelectItem>
              {abilityKeys.map((k) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {ABILITY_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SheetField>
        <TextField
          label="Заметки (СлОЖ, бонус атаки — вручную)"
          className="col-span-2 sm:col-span-3"
          value={spellcasting.notes}
          maxLength={5000}
          onChange={(notes) => patch({ spellcasting: { notes } })}
        />
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold">Ячейки заклинаний</h3>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-9">
          {spellcasting.slots.map((slot, idx) => (
            <div key={slot.level} className="rounded-md border p-1.5 text-center">
              <div className="text-[10px] font-semibold text-muted-foreground">
                {slot.level} круг
              </div>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <NumberField
                  label="Всего"
                  value={slot.total}
                  min={0}
                  max={20}
                  onChange={(total) => setSlots(idx, { total })}
                />
                <NumberField
                  label="Исп."
                  value={slot.used}
                  min={0}
                  max={20}
                  onChange={(used) => setSlots(idx, { used })}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-semibold">Заклинания</h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ui-hover h-7 text-xs"
            onClick={() =>
              patch({
                spellcasting: {
                  spells: [
                    ...spellcasting.spells,
                    {
                      name: "Новое заклинание",
                      level: 0,
                      prepared: false,
                      compendiumItemId: null,
                      notes: "",
                    },
                  ],
                },
              })
            }
          >
            <Plus className="size-3.5" /> Добавить
          </Button>
        </div>
        {spellcasting.spells.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">
            Заклинаний нет
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-7 text-xs">Название</TableHead>
                <TableHead className="h-7 w-20 text-xs">Круг</TableHead>
                <TableHead className="h-7 w-20 text-center text-xs">Подгот.</TableHead>
                <TableHead className="h-7 text-xs">Заметки</TableHead>
                <TableHead className="h-7 w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {spellcasting.spells.map((spell, idx) => (
                <TableRow key={idx}>
                  <TableCell className="py-1">
                    <TextField
                      label=""
                      value={spell.name}
                      maxLength={200}
                      onChange={(name) => setSpell(idx, { name })}
                    />
                  </TableCell>
                  <TableCell className="py-1">
                    <NumberField
                      label=""
                      value={spell.level}
                      min={0}
                      max={9}
                      onChange={(level) => setSpell(idx, { level })}
                    />
                  </TableCell>
                  <TableCell className="py-1 text-center">
                    <Checkbox
                      checked={spell.prepared}
                      onCheckedChange={(prepared) =>
                        setSpell(idx, { prepared: prepared === true })
                      }
                    />
                  </TableCell>
                  <TableCell className="py-1">
                    <TextField
                      label=""
                      value={spell.notes}
                      maxLength={2000}
                      onChange={(notes) => setSpell(idx, { notes })}
                    />
                  </TableCell>
                  <TableCell className="py-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="ui-hover size-7"
                      onClick={() =>
                        patch({
                          spellcasting: {
                            spells: spellcasting.spells.filter((_, i) => i !== idx),
                          },
                        })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
