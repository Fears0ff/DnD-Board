import { Shield, Swords } from "lucide-react";
import { toast } from "sonner";
import { api, invalidateGameState, invalidateUsers, trpcErrorMessage } from "@/lib/api";
import type { GameRole, UserDto } from "@/lib/game-contract";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

export function UsersDialog({
  open,
  onOpenChange,
  me,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: UserDto;
}) {
  const usersQuery = api.users.list.useQuery(undefined, {
    enabled: open,
    retry: 1,
  });
  const setRoleMutation = api.users.setGameRole.useMutation();

  const changeRole = (userId: number, gameRole: GameRole) => {
    setRoleMutation.mutate(
      { userId, gameRole },
      {
        onSuccess: () => {
          invalidateUsers();
          invalidateGameState();
        },
        onError: (err) => {
          toast.error(trpcErrorMessage(err, "Не удалось изменить роль"));
          invalidateUsers();
        },
      },
    );
  };

  const users = usersQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Пользователи и роли</DialogTitle>
          <DialogDescription className="text-xs">
            Мастер управляет игровыми ролями. Последнего мастера понизить нельзя.
          </DialogDescription>
        </DialogHeader>

        {usersQuery.isLoading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Загрузка…</p>
        ) : usersQuery.isError ? (
          <div className="space-y-2 py-4 text-center">
            <p className="text-xs text-destructive-foreground">
              {trpcErrorMessage(usersQuery.error, "Не удалось загрузить пользователей")}
            </p>
            <button
              type="button"
              className="ui-hover text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => void usersQuery.refetch()}
            >
              Повторить
            </button>
          </div>
        ) : users.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Пользователей нет</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Имя</TableHead>
                <TableHead className="text-xs">Логин</TableHead>
                <TableHead className="w-32 text-xs">Роль</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const isSelf = u.id === me.id;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="text-xs">
                      <span className="flex items-center gap-1.5">
                        {u.gameRole === "master" ? (
                          <Shield className="size-3.5 text-primary" />
                        ) : (
                          <Swords className="size-3.5 text-muted-foreground" />
                        )}
                        <span className="truncate">{u.displayName || u.login}</span>
                        {isSelf ? (
                          <Badge variant="secondary" className="px-1 text-[10px]">вы</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.login}</TableCell>
                    <TableCell>
                      <Select
                        value={u.gameRole}
                        onValueChange={(v) => changeRole(u.id, v as GameRole)}
                        disabled={setRoleMutation.isPending}
                      >
                        <SelectTrigger className="ui-hover h-7 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="master" className="text-xs">Мастер</SelectItem>
                          <SelectItem value="player" className="text-xs">Игрок</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
