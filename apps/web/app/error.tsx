"use client";

import { useEffect } from "react";
import { api } from "../lib/auth";
import { Button } from "../components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void api("/api/errors", {
      method: "POST",
      body: JSON.stringify({ message: error.message, context: { digest: error.digest, route: window.location.pathname } })
    }).catch(() => undefined);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <div className="max-w-md rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">iCanvas hit an unexpected error</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">A signed-in error report was queued for the self-hosted sync service. Your local offline board data remains in this browser.</p>
        <Button className="mt-5" type="button" onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
