// Shared constants for client and server. Keep this file free of Node/browser
// specific imports — it is pulled into the frontend bundle as well.

export const SESSION_COOKIE = "dnd_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
// Sliding renewal: once less than this remains, the server re-issues the cookie.
export const SESSION_RENEW_BELOW_SECONDS = (7 * 24 * 60 * 60) / 2;

export const WS_PATH = "/ws";
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

export const gameRoles = ["master", "player"] as const;
export type GameRole = (typeof gameRoles)[number];

export const tokenKinds = ["hero", "monster", "prop"] as const;
export type TokenKind = (typeof tokenKinds)[number];

export const compendiumTypes = [
  "spell",
  "item",
  "monster",
  "character",
  "species",
  "class",
  "feat",
  "background",
] as const;
export type CompendiumType = (typeof compendiumTypes)[number];

export const visibilityValues = ["private", "shared"] as const;
export type Visibility = (typeof visibilityValues)[number];

export const mediaBackends = ["local", "platform"] as const;
export type MediaBackend = (typeof mediaBackends)[number];

/** Realtime messages pushed over /ws. Notifications only, never full state. */
export type WsServerEvent =
  | { type: "game.changed"; revision: number }
  | { type: "compendium.changed"; revision: number };

export const wsEventTypes = ["game.changed", "compendium.changed"] as const;
