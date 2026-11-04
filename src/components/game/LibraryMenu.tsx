import { BookOpen, ChevronDown, NotebookPen, ScrollText, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function LibraryMenu({
  onOpenCompendium,
  onOpenCharacters,
  onOpenNotes,
}: {
  onOpenCompendium: () => void;
  onOpenCharacters: () => void;
  onOpenNotes: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="ui-hover h-8 gap-1.5 text-xs"
          title="Компедиум, листы персонажей и личные заметки"
          aria-label="Библиотека"
        >
          <BookOpen className="size-3.5" />
          <span className="hidden md:inline">Библиотека</span>
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem className="ui-hover gap-2 text-xs" onSelect={onOpenCompendium}>
          <ScrollText className="size-3.5 text-primary" />
          Компедиум
        </DropdownMenuItem>
        <DropdownMenuItem className="ui-hover gap-2 text-xs" onSelect={onOpenCharacters}>
          <UserRound className="size-3.5 text-primary" />
          Листы персонажей
        </DropdownMenuItem>
        <DropdownMenuItem className="ui-hover gap-2 text-xs" onSelect={onOpenNotes}>
          <NotebookPen className="size-3.5 text-primary" />
          Личные заметки
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
