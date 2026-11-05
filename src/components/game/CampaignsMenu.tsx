import { useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api, invalidateGameState, trpcErrorMessage } from "@/lib/api";
import type { CampaignDto } from "@/lib/game-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function CampaignsMenu({
  campaigns,
  activeCampaign,
  viewedCampaign,
  onViewCampaign,
}: {
  campaigns: CampaignDto[];
  activeCampaign: CampaignDto | null;
  viewedCampaign: CampaignDto | null;
  onViewCampaign: (id?: number) => void;
}) {
  const [formMode, setFormMode] = useState<"create" | "rename" | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [name, setName] = useState("");
  const createMutation = api.campaigns.create.useMutation();
  const renameMutation = api.campaigns.rename.useMutation();
  const setActiveMutation = api.campaigns.setActive.useMutation();
  const removeMutation = api.campaigns.remove.useMutation();
  const renaming = formMode === "rename" && viewedCampaign !== null;
  const pending = createMutation.isPending || renameMutation.isPending;

  const onError = (error: unknown, fallback: string) =>
    toast.error(trpcErrorMessage(error, fallback));
  const onSuccess = () => invalidateGameState();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Кампании" className="ui-hover h-8 max-w-52 gap-1.5 text-xs">
            <BookOpen className="size-3.5 shrink-0 text-primary" />
            <span className="truncate">{viewedCampaign?.name ?? "Нет кампании"}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {campaigns.length === 0 ? (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              Кампаний пока нет
            </DropdownMenuItem>
          ) : campaigns.map((campaign) => (
            <DropdownMenuItem
              key={campaign.id}
              className="ui-hover flex items-center gap-2 text-xs"
              onSelect={() => onViewCampaign(campaign.id)}
            >
              <span className="flex size-3.5 items-center justify-center">
                {viewedCampaign?.id === campaign.id ? <Check className="size-3.5 text-primary" /> : null}
              </span>
              <span className="truncate">{campaign.name}</span>
              {campaign.isActive ? (
                <span className="ml-auto shrink-0 text-[10px] font-medium text-primary">у игроков</span>
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="ui-hover text-xs"
            onSelect={() => {
              setName("");
              onViewCampaign(undefined);
              setFormMode("create");
            }}
          >
            <Plus className="size-3.5" /> Создать кампанию
          </DropdownMenuItem>
          {viewedCampaign ? (
            <>
              <DropdownMenuItem
                className="ui-hover text-xs"
                disabled={setActiveMutation.isPending}
                onSelect={() => setActiveMutation.mutate(
                  { id: activeCampaign?.id === viewedCampaign.id ? null : viewedCampaign.id },
                  {
                    onSuccess: () => {
                      onSuccess();
                      toast.success(activeCampaign?.id === viewedCampaign.id
                        ? "Активная кампания снята — игроки видят заглушку"
                        : `Кампания «${viewedCampaign.name}» теперь активна`);
                    },
                    onError: (error) => onError(error, "Не удалось изменить активную кампанию"),
                  },
                )}
              >
                {activeCampaign?.id === viewedCampaign.id ? (
                  <><EyeOff className="size-3.5" /> Скрыть игру от игроков</>
                ) : (
                  <><Eye className="size-3.5" /> Сделать активной для игроков</>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="ui-hover text-xs"
                onSelect={() => {
                  setName(viewedCampaign.name);
                  setFormMode("rename");
                }}
              >
                <Pencil className="size-3.5" /> Переименовать
              </DropdownMenuItem>
              <DropdownMenuItem
                className="ui-hover text-xs text-destructive-foreground"
                onSelect={() => setRemoveOpen(true)}
              >
                <Trash2 className="size-3.5" /> Удалить кампанию
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={formMode !== null} onOpenChange={(open) => setFormMode(open ? formMode : null)}>
        <DialogContent className="sm:max-w-xs" onOpenAutoFocus={() => setName(renaming ? viewedCampaign.name : "")}>
          <DialogHeader>
            <DialogTitle className="text-sm">{renaming ? "Название кампании" : "Новая кампания"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="campaign-name" className="text-xs">Название</Label>
            <Input id="campaign-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="ui-hover h-8 text-sm" />
          </div>
          <DialogFooter>
            <Button
              size="sm"
              className="ui-hover"
              disabled={pending || !name.trim()}
              onClick={() => {
                const options = {
                  onSuccess: () => {
                    onSuccess();
                    setFormMode(null);
                  },
                  onError: (error: unknown) => onError(error, "Не удалось сохранить кампанию"),
                };
                if (renaming) {
                  renameMutation.mutate({ id: viewedCampaign.id, name: name.trim() }, options);
                } else {
                  createMutation.mutate({ name: name.trim() }, options);
                }
              }}
            >
              {renaming ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Удалить кампанию</DialogTitle>
            <DialogDescription className="text-xs">
              Кампания «{viewedCampaign?.name}», все её поля и токены будут удалены безвозвратно.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" className="ui-hover" onClick={() => setRemoveOpen(false)}>Отмена</Button>
            <Button
              variant="destructive"
              size="sm"
              className="ui-hover"
              disabled={removeMutation.isPending}
              onClick={() => viewedCampaign && removeMutation.mutate(
                { id: viewedCampaign.id },
                {
                  onSuccess: () => {
                    onViewCampaign(undefined);
                    onSuccess();
                    setRemoveOpen(false);
                  },
                  onError: (error) => onError(error, "Не удалось удалить кампанию"),
                },
              )}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
