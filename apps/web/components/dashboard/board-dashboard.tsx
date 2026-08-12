"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Clock3, FilePlus2, Link2, Radio, Sparkles } from "lucide-react";
import {
  boardHref,
  createBoardAccessKey,
  createBoardId,
  getRecentBoards,
  type RecentBoard
} from "../../lib/boards";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

export function BoardDashboard() {
  const [recentBoards, setRecentBoards] = useState<RecentBoard[]>([]);
  const [draftBoard, setDraftBoard] = useState({ id: "", accessKey: "" });

  useEffect(() => {
    setRecentBoards(getRecentBoards());
    setDraftBoard({
      id: createBoardId(),
      accessKey: createBoardAccessKey()
    });
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-5">
        <header className="flex items-center justify-between border-b pb-4">
          <Link className="flex items-center gap-3" href="/">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-foreground text-sm font-bold text-background">
              iC
            </span>
            <div>
              <h1 className="text-base font-semibold leading-none">iCanvas</h1>
              <p className="mt-1 text-xs text-muted-foreground">Offline-first visual collaboration</p>
            </div>
          </Link>
          <Badge variant="success" className="hidden sm:inline-flex">
            <Radio className="mr-1 h-3.5 w-3.5" />
            self-hosted
          </Badge>
        </header>

        <section className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[1fr_380px]">
          <div className="max-w-2xl">
            <Badge variant="muted" className="mb-5">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Built for teams that think in motion
            </Badge>
            <h2 className="max-w-2xl text-4xl font-semibold leading-tight tracking-normal sm:text-5xl">
              A shared canvas that keeps working when the network does not.
            </h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
              Create a board, share the link, draw together live, keep editing offline, and replay
              how the room arrived at the answer.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href={draftBoard.id ? boardHref(draftBoard.id, draftBoard.accessKey) : "/boards/demo-board"}>
                  <FilePlus2 className="h-4 w-4" />
                  Create board
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/boards/demo-board">
                  Open demo
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle>Recent boards</CardTitle>
              <CardDescription>Boards are remembered locally on this browser.</CardDescription>
            </CardHeader>
            <CardContent>
              {recentBoards.length === 0 ? (
                <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
                  Your boards will appear here after you open them.
                </div>
              ) : (
                <div className="grid gap-2">
                  {recentBoards.map((board) => (
                    <Button
                      key={board.id}
                      asChild
                      variant="ghost"
                      className="h-auto justify-start rounded-md border px-3 py-3"
                    >
                      <Link href={boardHref(board.id, board.accessKey)}>
                        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                          <Link2 className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 text-left">
                          <span className="block truncate text-sm font-medium">{board.title}</span>
                          <span className="mt-1 flex items-center text-xs text-muted-foreground">
                            <Clock3 className="mr-1 h-3 w-3" />
                            {new Date(board.openedAt).toLocaleString()}
                          </span>
                        </span>
                      </Link>
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
