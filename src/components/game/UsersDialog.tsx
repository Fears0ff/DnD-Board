import { useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { api, usersListKey, reportMutationError, trpcErrorMessage } from "@/lib/api";
import { queryClient } from "@/providers/trpc";
import type { GameRole } from "@/lib/game-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { FullScreenLoader } from "./FullScreenState";

export function UsersDialog({
  open,
  onOpenChange,
  myId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  myId: number;
}) {
  const [actionError, setActionError] = useState<string | null>(null);

  const usersQuery = api.users.list.useQuery(undefined, { enabled: open });
  const setRole = api.users.setGameRole.useMutation({
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: [...usersListKey] });
      // Role changes may affect me too (self-demotion).
      void queryClient.invalidateQueries();
    },
    onError: (error) => {
      reportMutationError("setGameRole")(error);
      setActionError(trpcErrorMessage(error, "Не удалось сменить роль"));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="users-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4 text-primary" />
            Люди за столом
          </DialogTitle>
          <DialogDescription>
            Роли в общем пространстве. Первый зарегистрированный — мастер.
          </DialogDescription>
        </DialogHeader>

        {usersQuery.isLoading ? (
          <div className="py-6">
            <FullScreenLoader label="Загрузка списка…" />
          </div>
        ) : usersQuery.isError ? (
          <p className="py-4 text-sm text-destructive">
            {trpcErrorMessage(usersQuery.error, "Не удалось загрузить список")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Имя</TableHead>
                <TableHead>Логин</TableHead>
                <TableHead className="w-[140px]">Роль</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(usersQuery.data ?? []).map((u) => {
                const isSelf = u.id === myId;
                const isMaster = u.gameRole === "master";
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.displayName}
                      {isSelf ? (
                        <span className="ml-2 text-xs text-muted-foreground">(вы)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.login}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={isMaster ? "default" : "secondary"} className="gap-1">
                          {isMaster ? (
                            <ShieldCheck className="size-3" />
                          ) : (
                            <ShieldAlert className="size-3" />
                          )}
                          {isMaster ? "Мастер" : "Игрок"}
                        </Badge>
                        <Select
                          value={u.gameRole}
                          disabled={setRole.isPending}
                          onValueChange={(v) =>
                            setRole.mutate({ userId: u.id, gameRole: v as GameRole })
                          }
                        >
                          <SelectTrigger
                            size="sm"
                            className="ui-hover h-7 w-[110px] text-xs"
                            data-testid={`role-select-${u.id}`}
                          >
                            {setRole.isPending ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <SelectValue />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="master">Мастер</SelectItem>
                            <SelectItem value="player">Игрок</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {actionError ? (
          <p className="text-xs text-destructive">{actionError}</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" size="sm" className="ui-hover" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
