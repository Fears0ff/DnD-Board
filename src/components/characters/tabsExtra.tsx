import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NumberField, TextAreaField, TextField, SheetField } from "./fields";
import type { SheetTabProps } from "./tabsCore";

/* ---------------------------- Вкладка 4: Инвентарь -------------------------- */

export function InventoryTab({ sheet, patch }: SheetTabProps) {
  const inventory = sheet.inventory;
  const setItem = (idx: number, part: Partial<(typeof inventory.items)[number]>) =>
    patch({
      inventory: {
        items: inventory.items.map((it, i) => (i === idx ? { ...it, ...part } : it)),
      },
    });

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-semibold">Предметы</h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ui-hover h-7 text-xs"
            onClick={() =>
              patch({
                inventory: {
                  items: [
                    ...inventory.items,
                    {
                      name: "Новый предмет",
                      quantity: 1,
                      weight: 0,
                      attuned: false,
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
        {inventory.items.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">
            Инвентарь пуст
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-7 text-xs">Название</TableHead>
                <TableHead className="h-7 w-16 text-xs">Кол-во</TableHead>
                <TableHead className="h-7 w-16 text-xs">Вес</TableHead>
                <TableHead className="h-7 w-16 text-center text-xs">Настр.</TableHead>
                <TableHead className="h-7 text-xs">Заметки</TableHead>
                <TableHead className="h-7 w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventory.items.map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell className="py-1">
                    <TextField
                      value={item.name}
                      maxLength={200}
                      onChange={(name) => setItem(idx, { name })}
                    />
                  </TableCell>
                  <TableCell className="py-1">
                    <NumberField
                      value={item.quantity}
                      min={0}
                      max={100_000}
                      onChange={(quantity) => setItem(idx, { quantity })}
                    />
                  </TableCell>
                  <TableCell className="py-1">
                    <NumberField
                      value={item.weight}
                      min={0}
                      max={100_000}
                      onChange={(weight) => setItem(idx, { weight })}
                    />
                  </TableCell>
                  <TableCell className="py-1 text-center">
                    <Checkbox
                      checked={item.attuned}
                      onCheckedChange={(attuned) =>
                        setItem(idx, { attuned: attuned === true })
                      }
                    />
                  </TableCell>
                  <TableCell className="py-1">
                    <TextField
                      value={item.notes}
                      maxLength={2000}
                      onChange={(notes) => setItem(idx, { notes })}
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
                          inventory: {
                            items: inventory.items.filter((_, i) => i !== idx),
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

      <div>
        <h3 className="mb-1 text-xs font-semibold">Монеты</h3>
        <div className="grid grid-cols-5 gap-2">
          {(
            [
              ["cp", "ММ"],
              ["sp", "СМ"],
              ["ep", "ЭМ"],
              ["gp", "ЗМ"],
              ["pp", "ПМ"],
            ] as const
          ).map(([key, label]) => (
            <NumberField
              key={key}
              label={label}
              value={inventory.currency[key]}
              min={0}
              max={1_000_000_000}
              onChange={(v) =>
                patch({
                  inventory: { currency: { ...inventory.currency, [key]: v } },
                })
              }
            />
          ))}
        </div>
      </div>

      <TextAreaField
        label="Прочее снаряжение"
        value={inventory.otherEquipment}
        maxLength={5000}
        onChange={(otherEquipment) => patch({ inventory: { otherEquipment } })}
      />
    </div>
  );
}

/* ------------------------------ Вкладка 5: Атаки ---------------------------- */

export function AttacksTab({ sheet, patch }: SheetTabProps) {
  const attacks = sheet.attacks;
  const setAttack = (idx: number, part: Partial<(typeof attacks.list)[number]>) =>
    patch({
      attacks: {
        list: attacks.list.map((a, i) => (i === idx ? { ...a, ...part } : a)),
      },
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">
          Бросков и автоматических вычислений нет: бонус атаки и урон
          записываются вручную как текст (например, «+5» и «1к8+3 рубящий»).
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ui-hover h-7 shrink-0 text-xs"
          onClick={() =>
            patch({
              attacks: {
                list: [
                  ...attacks.list,
                  { name: "Новая атака", attackBonus: "", damage: "", damageType: "", notes: "" },
                ],
              },
            })
          }
        >
          <Plus className="size-3.5" /> Добавить
        </Button>
      </div>
      {attacks.list.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">
          Атак не добавлено
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-7 text-xs">Название</TableHead>
              <TableHead className="h-7 w-20 text-xs">Бонус</TableHead>
              <TableHead className="h-7 w-28 text-xs">Урон</TableHead>
              <TableHead className="h-7 w-24 text-xs">Тип</TableHead>
              <TableHead className="h-7 text-xs">Заметки</TableHead>
              <TableHead className="h-7 w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {attacks.list.map((attack, idx) => (
              <TableRow key={idx}>
                <TableCell className="py-1">
                  <TextField
                    value={attack.name}
                    maxLength={120}
                    onChange={(name) => setAttack(idx, { name })}
                  />
                </TableCell>
                <TableCell className="py-1">
                  <TextField
                    value={attack.attackBonus}
                    maxLength={40}
                    onChange={(attackBonus) => setAttack(idx, { attackBonus })}
                  />
                </TableCell>
                <TableCell className="py-1">
                  <TextField
                    value={attack.damage}
                    maxLength={120}
                    onChange={(damage) => setAttack(idx, { damage })}
                  />
                </TableCell>
                <TableCell className="py-1">
                  <TextField
                    value={attack.damageType}
                    maxLength={60}
                    onChange={(damageType) => setAttack(idx, { damageType })}
                  />
                </TableCell>
                <TableCell className="py-1">
                  <TextField
                    value={attack.notes}
                    maxLength={2000}
                    onChange={(notes) => setAttack(idx, { notes })}
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
                        attacks: { list: attacks.list.filter((_, i) => i !== idx) },
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
      <TextAreaField
        label="Заметки к атакам"
        value={attacks.notes}
        maxLength={5000}
        onChange={(notes) => patch({ attacks: { notes } })}
      />
    </div>
  );
}

/* --------------------------- Вкладка 6: Свойства ---------------------------- */

export function TraitsTab({ sheet, patch }: SheetTabProps) {
  const traits = sheet.traits;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextAreaField
        label="Умения и особенности"
        rows={5}
        value={traits.featuresAndTraits}
        maxLength={20000}
        onChange={(featuresAndTraits) => patch({ traits: { featuresAndTraits } })}
      />
      <TextAreaField
        label="Прочие владения и языки"
        rows={5}
        value={traits.otherProficienciesAndLanguages}
        maxLength={10000}
        onChange={(otherProficienciesAndLanguages) =>
          patch({ traits: { otherProficienciesAndLanguages } })
        }
      />
      <TextAreaField
        label="Внешность"
        value={traits.appearance}
        maxLength={10000}
        onChange={(appearance) => patch({ traits: { appearance } })}
      />
      <TextAreaField
        label="Союзники и организации"
        value={traits.alliesAndOrganizations}
        maxLength={10000}
        onChange={(alliesAndOrganizations) =>
          patch({ traits: { alliesAndOrganizations } })
        }
      />
      <TextAreaField
        label="Предыстория"
        rows={5}
        value={traits.backstory}
        maxLength={20000}
        onChange={(backstory) => patch({ traits: { backstory } })}
      />
      <TextAreaField
        label="Дополнительные заметки"
        rows={5}
        value={traits.additionalNotes}
        maxLength={20000}
        onChange={(additionalNotes) => patch({ traits: { additionalNotes } })}
      />
    </div>
  );
}

/* ----------------------- Вкладка 7: Поля редакции 2024 ---------------------- */

export function VitalsTab({ sheet, patch }: SheetTabProps) {
  const vitals = sheet.vitals;
  const [conditionDraft, setConditionDraft] = useState("");

  const addCondition = () => {
    const value = conditionDraft.trim().slice(0, 60);
    if (!value || sheet.vitals.conditions.length >= 30) return;
    patch({ vitals: { conditions: [...sheet.vitals.conditions, value] } });
    setConditionDraft("");
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <NumberField
          label="Класс брони"
          value={vitals.armorClass}
          min={0}
          max={50}
          onChange={(armorClass) => patch({ vitals: { armorClass } })}
        />
        <NumberField
          label="Инициатива (вручную)"
          value={vitals.initiative}
          min={-20}
          max={30}
          onChange={(initiative) => patch({ vitals: { initiative } })}
        />
        <NumberField
          label="Скорость"
          value={vitals.speed}
          min={0}
          max={300}
          onChange={(speed) => patch({ vitals: { speed } })}
        />
        <NumberField
          label="Пассивное Восприятие"
          value={vitals.passivePerception}
          min={0}
          max={50}
          onChange={(passivePerception) => patch({ vitals: { passivePerception } })}
        />
        <NumberField
          label="Текущие ПЗ"
          value={vitals.currentHp}
          min={0}
          max={2000}
          onChange={(currentHp) => patch({ vitals: { currentHp } })}
        />
        <NumberField
          label="Максимум ПЗ"
          value={vitals.maxHp}
          min={0}
          max={2000}
          onChange={(maxHp) => patch({ vitals: { maxHp } })}
        />
        <NumberField
          label="Временные ПЗ"
          value={vitals.tempHp}
          min={0}
          max={2000}
          onChange={(tempHp) => patch({ vitals: { tempHp } })}
        />
        <TextField
          label="Кости хитов"
          value={vitals.hitDice}
          maxLength={40}
          placeholder="например, 3к10"
          onChange={(hitDice) => patch({ vitals: { hitDice } })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField
          label="Истощение (уровни)"
          value={vitals.exhaustion}
          min={0}
          max={10}
          onChange={(exhaustion) => patch({ vitals: { exhaustion } })}
        />
        <SheetField label="Героическое вдохновение">
          <div className="flex h-7 items-center gap-2">
            <Switch
              checked={vitals.heroicInspiration}
              onCheckedChange={(heroicInspiration) =>
                patch({ vitals: { heroicInspiration } })
              }
            />
            <span className="text-xs text-muted-foreground">
              {vitals.heroicInspiration ? "есть" : "нет"}
            </span>
          </div>
        </SheetField>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Спасброски смерти: успехи"
            value={vitals.deathSaves.successes}
            min={0}
            max={3}
            onChange={(successes) =>
              patch({ vitals: { deathSaves: { ...vitals.deathSaves, successes } } })
            }
          />
          <NumberField
            label="провалы"
            value={vitals.deathSaves.failures}
            min={0}
            max={3}
            onChange={(failures) =>
              patch({ vitals: { deathSaves: { ...vitals.deathSaves, failures } } })
            }
          />
        </div>
      </div>

      <SheetField label="Состояния">
        <div className="flex flex-wrap items-center gap-1.5">
          {vitals.conditions.map((condition, idx) => (
            <Badge key={`${condition}-${idx}`} variant="secondary" className="gap-1 text-xs">
              {condition}
              <button
                type="button"
                className="ui-hover rounded-sm"
                onClick={() =>
                  patch({
                    vitals: {
                      conditions: vitals.conditions.filter((_, i) => i !== idx),
                    },
                  })
                }
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <Input
            className="ui-hover h-7 w-44 text-xs"
            placeholder="Новое состояние…"
            value={conditionDraft}
            maxLength={60}
            onChange={(e) => setConditionDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCondition();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ui-hover h-7 text-xs"
            onClick={addCondition}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </SheetField>
      <p className="text-[10px] text-muted-foreground">
        ПЗ, КБ, инициатива и прочие поля заполняются вручную; сервер ничего
        не вычисляет и не изменяет автоматически.
      </p>
    </div>
  );
}

/* -------------------- Вкладка 8: импорт Long Story Short -------------------- */

import type { LongStoryShortExtension } from "@contracts/characters";

/** Подписи секций расширения LSS (read-only просмотр сохранённых данных). */
const LSS_SECTION_LABELS: [keyof LongStoryShortExtension, string][] = [
  ["resources", "Ресурсы и кости"],
  ["bonusesSkills", "Бонусы навыков"],
  ["bonusesStats", "Бонусы характеристик"],
  ["bonuses", "Прочие бонусы"],
  ["proficiencies", "Флаги владений LSS"],
  ["attunements", "Настройка предметов (attunement)"],
  ["spells", "Книга заклинаний LSS"],
  ["settings", "Настройки листа LSS"],
  ["unmappedText", "Текстовые блоки без аналога"],
  ["unknownFields", "Нераспознанные поля листа"],
  ["unknownOuterFields", "Нераспознанные поля выгрузки"],
];

function isEmptyJson(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/**
 * Только чтение: данные, сохранённые при импорте из Long Story Short, которые
 * лист пока не поддерживает. Не редактируется и не дублируется в заметки.
 */
export function LssExtensionTab({ sheet }: Pick<SheetTabProps, "patch" | "sheet">) {
  const ext = sheet.extensions?.longStoryShort;
  if (!ext) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        Этот лист не импортирован из Long Story Short.
      </p>
    );
  }
  const sections = LSS_SECTION_LABELS.filter(([key]) => !isEmptyJson(ext[key]));
  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted-foreground">
        Импортировано из Long Story Short
        {ext.importedAt ? ` (${new Date(ext.importedAt).toLocaleString("ru-RU")})` : ""}
        {ext.edition ? ` · редакция ${ext.edition}` : ""}
        {ext.sheetEdition ? ` · лист ${ext.sheetEdition}` : ""}. Данные ниже
        сохранены как есть и доступны только для чтения.
      </p>
      {sections.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Дополнительных данных нет — всё содержимое файла сопоставлено полям листа.
        </p>
      ) : (
        sections.map(([key, label]) => (
          <div key={key}>
            <h3 className="mb-1 text-xs font-semibold">{label}</h3>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted/40 p-2 text-[10px] leading-relaxed">
              {JSON.stringify(ext[key], null, 2)}
            </pre>
          </div>
        ))
      )}
    </div>
  );
}
