/**
 * Игровые DTO берутся из общих контрактов (@contracts), чтобы клиент и
 * сервер не расходились в типах. Здесь же — чисто клиентские константы.
 */
import type { TokenKind } from "@contracts/types";

export type {
  BoardDto,
  GameRole,
  GameStateDto,
  InitiativeEntry,
  TokenAddInput,
  TokenDto,
  TokenKind,
  TokenUpdateInput,
  UserDto,
} from "@contracts/types";

export const TOKEN_KIND_LABELS: Record<TokenKind, string> = {
  hero: "Герой",
  monster: "Монстр",
  prop: "Объект",
};
