import { Server } from "@hocuspocus/server";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as Y from "yjs";
import type { ReplayUpdate } from "@icanvas/shared";

const port = Number(process.env.SYNC_PORT ?? 1234);
const dataDir = path.resolve(process.env.SYNC_DATA_DIR ?? "./data");

function boardDir(documentName: string): string {
  const safeName = encodeURIComponent(documentName).replaceAll("%", "_");
  return path.join(dataDir, safeName);
}

async function ensureBoardDir(documentName: string): Promise<string> {
  const directory = boardDir(documentName);
  await mkdir(directory, { recursive: true });
  return directory;
}

async function readSnapshot(documentName: string): Promise<Uint8Array | undefined> {
  const snapshotPath = path.join(boardDir(documentName), "snapshot.bin");

  if (!existsSync(snapshotPath)) {
    return undefined;
  }

  return new Uint8Array(await readFile(snapshotPath));
}

async function writeSnapshot(documentName: string, document: Y.Doc): Promise<void> {
  const directory = await ensureBoardDir(documentName);
  const snapshot = Y.encodeStateAsUpdate(document);
  await writeFile(path.join(directory, "snapshot.bin"), snapshot);
}

async function appendReplayUpdate(documentName: string, update: Uint8Array): Promise<void> {
  const directory = await ensureBoardDir(documentName);
  const entry: ReplayUpdate = {
    timestamp: Date.now(),
    update: Buffer.from(update).toString("base64")
  };

  await appendFile(path.join(directory, "updates.jsonl"), `${JSON.stringify(entry)}\n`);
}

async function readReplayUpdates(documentName: string): Promise<ReplayUpdate[]> {
  const logPath = path.join(boardDir(documentName), "updates.jsonl");

  if (!existsSync(logPath)) {
    return [];
  }

  const raw = await readFile(logPath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReplayUpdate);
}

function sendJson(
  response: { writeHead: (statusCode: number, headers: Record<string, string>) => void; end: (body?: string) => void },
  statusCode: number,
  payload: unknown
) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Content-Type": "application/json"
  });
  response.end(JSON.stringify(payload));
}

const server = new Server({
  name: "icanvas-sync",
  port,
  debounce: 1200,
  maxDebounce: 5000,

  async onLoadDocument({ documentName }) {
    return readSnapshot(documentName);
  },

  async onChange({ documentName, update }) {
    await appendReplayUpdate(documentName, update);
  },

  async onStoreDocument({ documentName, document }) {
    await writeSnapshot(documentName, document);
  },

  async onRequest({ request, response }) {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      throw null;
    }

    if (url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "icanvas-sync"
      });
      throw null;
    }

    const replayMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/replay$/);

    if (request.method === "GET" && replayMatch) {
      const documentName = decodeURIComponent(replayMatch[1]);
      const updates = await readReplayUpdates(documentName);
      sendJson(response, 200, { updates });
      throw null;
    }

    sendJson(response, 404, {
      error: "Not found"
    });
    throw null;
  }
});

server.listen().then(() => {
  console.log(`iCanvas sync server listening on ws://localhost:${port}`);
  console.log(`Replay API listening on http://localhost:${port}/api/boards/:boardId/replay`);
});
