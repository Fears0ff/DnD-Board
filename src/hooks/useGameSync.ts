import { useEffect, useRef, useState } from "react";
import { api, gameStateKey, type QueryResult } from "@/lib/api";
import { queryClient } from "@/providers/trpc";
import { GameRealtime, realtimeUrl, type RealtimeStatus } from "@/lib/realtime";
import type { GameStateDto } from "@/lib/game-contract";

const POLL_INTERVAL_MS = 4_000;

export interface GameSync {
  query: QueryResult<GameStateDto>;
  wsStatus: RealtimeStatus;
}

/**
 * Единая точка синхронизации игрового состояния:
 * - WS /ws: на open и на каждое game.changed инвалидирует game.state;
 * - сообщение со старой ревизией игнорируется (снимки не откатываются);
 * - пока WS не открыт — polling game.state каждые 4 секунды;
 * - после восстановления WS полный refetch, polling останавливается.
 */
export function useGameSync(enabled: boolean): GameSync {
  const [wsStatus, setWsStatus] = useState<RealtimeStatus>("closed");

  const query = api.game.state.useQuery(undefined, {
    enabled,
    retry: 1,
    refetchOnWindowFocus: true,
    refetchInterval: enabled && wsStatus !== "open" ? POLL_INTERVAL_MS : false,
  });

  const appliedRevisionRef = useRef<number | null>(null);
  useEffect(() => {
    if (query.data) appliedRevisionRef.current = query.data.revision;
  }, [query.data]);

  useEffect(() => {
    if (!enabled) return;
    const rt = new GameRealtime(realtimeUrl());
    const offStatus = rt.onStatus(setWsStatus);
    const offOpen = rt.onOpen(() => {
      // закрываем окно между HTTP-снимком и подпиской
      void queryClient.invalidateQueries({ queryKey: [...gameStateKey] });
    });
    const offMessage = rt.onMessage((msg) => {
      if (msg.type !== "game.changed") return;
      const applied = appliedRevisionRef.current;
      if (
        typeof msg.revision === "number" &&
        applied !== null &&
        msg.revision <= applied
      ) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: [...gameStateKey] });
    });
    rt.start();
    return () => {
      offStatus();
      offOpen();
      offMessage();
      rt.dispose();
      setWsStatus("closed");
    };
  }, [enabled]);

  return { query, wsStatus };
}
