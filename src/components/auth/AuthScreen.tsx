import { useState, type FormEvent } from "react";
import { LogIn, UserPlus, Loader2 } from "lucide-react";
import { api, invalidateAuth, trpcErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrandMark } from "@/components/game/FullScreenState";

export function AuthScreen() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loginMutation = api.auth.login.useMutation();
  const registerMutation = api.auth.register.useMutation();
  const pending = loginMutation.isPending || registerMutation.isPending;

  const onSuccess = () => {
    setError(null);
    invalidateAuth();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedLogin = login.trim();
    if (!trimmedLogin || !password) {
      setError("Введите логин и пароль");
      return;
    }
    if (tab === "register") {
      if (password.length < 8) {
        setError("Пароль слишком короткий (минимум 8 символов)");
        return;
      }
      if (password !== confirm) {
        setError("Пароли не совпадают");
        return;
      }
      registerMutation.mutate(
        {
          login: trimmedLogin,
          password,
          displayName: displayName.trim() || undefined,
        },
        {
          onSuccess,
          onError: (err) => setError(trpcErrorMessage(err, "Не удалось зарегистрироваться")),
        },
      );
    } else {
      loginMutation.mutate(
        { login: trimmedLogin, password },
        {
          onSuccess,
          onError: (err) => setError(trpcErrorMessage(err, "Не удалось войти")),
        },
      );
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <BrandMark className="size-9" />
          <div>
            <h1 className="text-lg font-semibold tracking-wide">DnD Board</h1>
            <p className="text-xs text-muted-foreground">
              Общее игровое поле для D&D в локальной сети
            </p>
          </div>
        </div>

        <div className="panel p-4">
          <Tabs value={tab} onValueChange={(v) => { setTab(v as "login" | "register"); setError(null); }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login" className="ui-hover text-xs">
                <LogIn className="mr-1.5 size-3.5" />
                Вход
              </TabsTrigger>
              <TabsTrigger value="register" className="ui-hover text-xs">
                <UserPlus className="mr-1.5 size-3.5" />
                Регистрация
              </TabsTrigger>
            </TabsList>

            <form onSubmit={submit} className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="login" className="text-xs">Логин</Label>
                <Input
                  id="login"
                  autoComplete="username"
                  autoFocus
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  className="ui-hover h-9 text-sm"
                  disabled={pending}
                />
              </div>

              <TabsContent value="register" className="mt-0 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="displayName" className="text-xs">
                    Имя за столом <span className="text-muted-foreground">(необязательно)</span>
                  </Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="ui-hover h-9 text-sm"
                    disabled={pending}
                  />
                </div>
              </TabsContent>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs">Пароль</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={tab === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="ui-hover h-9 text-sm"
                  disabled={pending}
                />
              </div>

              <TabsContent value="register" className="mt-0">
                <div className="space-y-1.5">
                  <Label htmlFor="confirm" className="text-xs">Повторите пароль</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="ui-hover h-9 text-sm"
                    disabled={pending}
                  />
                </div>
              </TabsContent>

              {error ? (
                <p className="rounded-sm border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive-foreground">
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="ui-hover h-9 w-full text-sm" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {tab === "login" ? "Войти" : "Создать аккаунт"}
              </Button>

              <TabsContent value="register" className="mt-0">
                <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                  Первый зарегистрированный пользователь становится мастером,
                  остальные — игроками.
                </p>
              </TabsContent>
            </form>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
