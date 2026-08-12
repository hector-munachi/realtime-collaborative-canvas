"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Clock3, FilePlus2, Link2, LogOut, Radio, ShieldCheck, Sparkles } from "lucide-react";
import { api, authenticate, clearSession, getSession, type AuthSession } from "../../lib/auth";
import { boardHref } from "../../lib/boards";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

type Board = { id: string; title: string; updatedAt: number; members: Array<{ userId: string; role: string }> };

export function BoardDashboard() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [mode, setMode] = useState<"login" | "register">("register");
  const [credentials, setCredentials] = useState({ name: "", email: "", password: "" });
  const [boardTitle, setBoardTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadBoards = async () => {
    try {
      const result = await api<{ boards: Board[] }>("/api/boards");
      setBoards(result.boards);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load boards.");
    }
  };

  useEffect(() => {
    const stored = getSession();
    setSession(stored);
    if (stored) void loadBoards();
  }, []);

  const submitAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await authenticate(mode, credentials);
      setSession(next);
      await loadBoards();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  const createBoard = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ board: Board }>("/api/boards", {
        method: "POST",
        body: JSON.stringify({ title: boardTitle })
      });
      router.push(boardHref(result.board.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not create board.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-5">
        <header className="flex items-center justify-between border-b pb-4">
          <Link className="flex items-center gap-3" href="/">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-foreground text-sm font-bold text-background">iC</span>
            <div><h1 className="text-base font-semibold leading-none">iCanvas</h1><p className="mt-1 text-xs text-muted-foreground">Private, offline-first visual collaboration</p></div>
          </Link>
          {session ? (
            <div className="flex items-center gap-2"><Badge variant="success" className="hidden sm:inline-flex"><ShieldCheck className="mr-1 h-3.5 w-3.5" />{session.user.name}</Badge><Button variant="ghost" size="sm" onClick={() => { clearSession(); setSession(null); setBoards([]); }}><LogOut className="h-4 w-4" />Sign out</Button></div>
          ) : <Badge variant="muted" className="hidden sm:inline-flex"><ShieldCheck className="mr-1 h-3.5 w-3.5" />account required</Badge>}
        </header>

        {!session ? (
          <section className="mx-auto grid w-full max-w-4xl flex-1 items-center gap-8 py-10 lg:grid-cols-[1fr_360px]">
            <div><Badge variant="muted" className="mb-5"><Sparkles className="mr-1.5 h-3.5 w-3.5" />Private boards, self-hosted</Badge><h2 className="text-4xl font-semibold leading-tight sm:text-5xl">A shared canvas that keeps working when the network does not.</h2><p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">Create an account to own boards, invite editors or viewers, and keep collaboration data on your own sync service.</p></div>
            <Card><CardHeader><CardTitle>{mode === "register" ? "Create your workspace" : "Welcome back"}</CardTitle><CardDescription>Authentication is enforced for the canvas, replay, and board APIs.</CardDescription></CardHeader><CardContent><form className="grid gap-3" onSubmit={submitAuth}>{mode === "register" ? <input className="rounded-md border bg-background px-3 py-2 text-sm" placeholder="Name" required value={credentials.name} onChange={(event) => setCredentials({ ...credentials, name: event.currentTarget.value })} /> : null}<input className="rounded-md border bg-background px-3 py-2 text-sm" type="email" placeholder="Email" required value={credentials.email} onChange={(event) => setCredentials({ ...credentials, email: event.currentTarget.value })} /><input className="rounded-md border bg-background px-3 py-2 text-sm" type="password" minLength={12} placeholder="Password (12+ characters)" required value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.currentTarget.value })} />{error ? <p className="text-sm text-destructive">{error}</p> : null}<Button type="submit" disabled={busy}>{mode === "register" ? "Create account" : "Sign in"}<ArrowRight className="h-4 w-4" /></Button><Button type="button" variant="ghost" onClick={() => { setMode(mode === "register" ? "login" : "register"); setError(""); }}>{mode === "register" ? "Already have an account? Sign in" : "New here? Create an account"}</Button></form></CardContent></Card>
          </section>
        ) : (
          <section className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[1fr_380px]">
            <div className="max-w-2xl"><Badge variant="success" className="mb-5"><Radio className="mr-1.5 h-3.5 w-3.5" />authenticated sync</Badge><h2 className="text-4xl font-semibold leading-tight sm:text-5xl">Your private visual workspace.</h2><p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">Every board is protected by server-side membership. Owners can grant editor or viewer access from a board.</p><div className="mt-7 flex gap-3"><input className="w-full max-w-sm rounded-md border bg-background px-3 py-2 text-sm" placeholder="New board title" value={boardTitle} onChange={(event) => setBoardTitle(event.currentTarget.value)} /><Button size="lg" disabled={busy} onClick={() => void createBoard()}><FilePlus2 className="h-4 w-4" />Create board</Button></div>{error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}</div>
            <Card><CardHeader><CardTitle>Your boards</CardTitle><CardDescription>Server-authorized boards available to this account.</CardDescription></CardHeader><CardContent>{boards.length === 0 ? <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">Create a private board to begin.</div> : <div className="grid gap-2">{boards.map((board) => <Button key={board.id} asChild variant="ghost" className="h-auto justify-start rounded-md border px-3 py-3"><Link href={boardHref(board.id)}><span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted"><Link2 className="h-4 w-4" /></span><span className="min-w-0 text-left"><span className="block truncate text-sm font-medium">{board.title}</span><span className="mt-1 flex items-center text-xs text-muted-foreground"><Clock3 className="mr-1 h-3 w-3" />{new Date(board.updatedAt).toLocaleString()}</span></span></Link></Button>)}</div>}</CardContent></Card>
          </section>
        )}
      </div>
    </main>
  );
}
