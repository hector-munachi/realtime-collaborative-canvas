import { Server } from "@hocuspocus/server";
import { existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as Y from "yjs";
import { type ReplayUpdate } from "@icanvas/shared";
import {
  SecurityStore,
  createSessionToken,
  securityFile,
  sessionFor,
  verifySessionToken,
  type BoardRole,
  type Session
} from "./security.js";
import { assertObjectPermissions } from "./object-permissions.js";

const port = Number(process.env.SYNC_PORT ?? 1234);
const dataDir = path.resolve(process.env.SYNC_DATA_DIR ?? "./data");
const backupDir = path.resolve(process.env.SYNC_BACKUP_DIR ?? path.join(dataDir, "backups"));
const authSecret = process.env.SYNC_AUTH_SECRET ?? "local-development-secret-change-before-production";
const replayRetentionMs = Number(process.env.SYNC_REPLAY_RETENTION_DAYS ?? 30) * 86_400_000;
const maxReplayEntries = Number(process.env.SYNC_REPLAY_MAX_ENTRIES ?? 20_000);
const allowedOrigins = new Set(
  (process.env.SYNC_ALLOWED_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const requestWindowMs = 60_000;
const requestLimit = Number(process.env.SYNC_RATE_LIMIT_PER_MINUTE ?? 120);
const requestCounters = new Map<string, { count: number; startedAt: number }>();
const metrics = { startedAt: Date.now(), requests: 0, denied: 0, errors: 0, replayCompactions: 0 };
const security = new SecurityStore(securityFile(dataDir));

type Response = {
  writeHead: (statusCode: number, headers: Record<string, string | number>) => void;
  end: (body?: string) => void;
};

function boardDir(documentName: string): string {
  const safeName = encodeURIComponent(documentName).replaceAll("%", "_");
  return path.join(dataDir, "boards", safeName);
}

function boardIdFromDocumentName(documentName: string) {
  // Board IDs are server-issued now. Reject historical key-suffixed names instead of
  // accidentally treating a client-generated share key as authorization.
  return /^board_[A-Za-z0-9_-]+$/.test(documentName) ? documentName : null;
}

async function ensureBoardDir(documentName: string): Promise<string> {
  const directory = boardDir(documentName);
  await mkdir(directory, { recursive: true });
  return directory;
}

async function readSnapshot(documentName: string): Promise<Uint8Array | undefined> {
  const snapshotPath = path.join(boardDir(documentName), "snapshot.bin");
  if (!existsSync(snapshotPath)) return undefined;
  return new Uint8Array(await readFile(snapshotPath));
}

async function writeSnapshot(documentName: string, document: Y.Doc): Promise<void> {
  const directory = await ensureBoardDir(documentName);
  const snapshotPath = path.join(directory, "snapshot.bin");
  await writeFile(snapshotPath, Y.encodeStateAsUpdate(document));
  await mkdir(backupDir, { recursive: true });
  await copyFile(snapshotPath, path.join(backupDir, `${encodeURIComponent(documentName)}-latest.bin`));
}

async function appendReplayUpdate(documentName: string, update: Uint8Array): Promise<void> {
  const directory = await ensureBoardDir(documentName);
  const entry: ReplayUpdate = { timestamp: Date.now(), update: Buffer.from(update).toString("base64") };
  await appendFile(path.join(directory, "updates.jsonl"), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  await compactReplayLog(documentName);
}

async function readReplayUpdates(documentName: string): Promise<ReplayUpdate[]> {
  const logPath = path.join(boardDir(documentName), "updates.jsonl");
  if (!existsSync(logPath)) return [];
  const raw = await readFile(logPath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const event = JSON.parse(line) as ReplayUpdate;
        return typeof event.timestamp === "number" && typeof event.update === "string" ? [event] : [];
      } catch {
        return [];
      }
    });
}

async function compactReplayLog(documentName: string) {
  const entries = await readReplayUpdates(documentName);
  const cutoff = Date.now() - replayRetentionMs;
  const retained = entries.filter((entry) => entry.timestamp >= cutoff).slice(-maxReplayEntries);
  if (retained.length === entries.length) return;
  const directory = await ensureBoardDir(documentName);
  await writeFile(path.join(directory, "updates.jsonl"), retained.map((entry) => JSON.stringify(entry)).join("\n") + (retained.length ? "\n" : ""), { mode: 0o600 });
  metrics.replayCompactions += 1;
}

function corsHeaders(request: { headers: Record<string, string | string[] | undefined> }) {
  const origin = request.headers.origin;
  const value = Array.isArray(origin) ? origin[0] : origin;
  const permitted = value && allowedOrigins.has(value) ? value : undefined;
  return {
    ...(permitted ? { "Access-Control-Allow-Origin": permitted, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Metrics-Key",
    "Content-Type": "application/json",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store"
  };
}

function sendJson(request: { headers: Record<string, string | string[] | undefined> }, response: Response, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, corsHeaders(request));
  response.end(JSON.stringify(payload));
}

function clientKey(request: { headers: Record<string, string | string[] | undefined> }) {
  const forwarded = request.headers["x-forwarded-for"];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() ?? "local";
}

function rateLimit(request: { headers: Record<string, string | string[] | undefined> }) {
  const key = clientKey(request);
  const now = Date.now();
  const current = requestCounters.get(key);
  if (!current || now - current.startedAt >= requestWindowMs) {
    requestCounters.set(key, { count: 1, startedAt: now });
    return true;
  }
  current.count += 1;
  return current.count <= requestLimit;
}

function bearer(request: { headers: Record<string, string | string[] | undefined> }): Session | null {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  return value?.startsWith("Bearer ") ? verifySessionToken(value.slice(7), authSecret) : null;
}

async function requireBoardRole(request: { headers: Record<string, string | string[] | undefined> }, boardId: string, minimum: "read" | "write" = "read") {
  const session = bearer(request);
  if (!session) return null;
  const role = await security.roleFor(boardId, session.userId);
  if (!role || (minimum === "write" && role === "viewer")) return null;
  return { session, role };
}

async function requestBody(request: { on: (event: "data" | "end", callback: (chunk?: Buffer) => void) => void }) {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve) => {
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk ?? "")));
    request.on("end", () => resolve());
  });
  if (Buffer.concat(chunks).byteLength > 64_000) throw new Error("Request body is too large.");
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
}

async function reportError(payload: Record<string, unknown>, session: Session) {
  const directory = path.join(dataDir, "reports");
  await mkdir(directory, { recursive: true });
  const line = JSON.stringify({ timestamp: Date.now(), userId: session.userId, message: String(payload.message ?? "Unknown client error").slice(0, 1000), context: payload.context ?? null });
  await appendFile(path.join(directory, "client-errors.jsonl"), `${line}\n`, { mode: 0o600 });
}

const server = new Server({
  name: "icanvas-sync",
  port,
  debounce: 1200,
  maxDebounce: 5000,

  async onConnect({ requestHeaders }) {
    const origin = requestHeaders.get("origin");
    if (origin && !allowedOrigins.has(origin)) throw new Error("WebSocket origin is not allowed.");
  },

  async onAuthenticate({ token, documentName, connectionConfig }) {
    const boardId = boardIdFromDocumentName(documentName);
    const session = verifySessionToken(token, authSecret);
    if (!boardId || !session) throw new Error("Authentication required.");
    const role = await security.roleFor(boardId, session.userId);
    if (!role) throw new Error("You do not have access to this board.");
    connectionConfig.readOnly = role === "viewer";
    return { user: session, role };
  },

  async onLoadDocument({ documentName }) {
    return readSnapshot(documentName);
  },

  async beforeSync({ document, type, payload, context }) {
    const userId = (context as { user?: Session } | undefined)?.user?.userId;
    if (!userId) throw new Error("Authentication required.");
    // Yjs sync step 2 and incremental update messages carry a Yjs update. Step 1 is a state-vector request only.
    if (type === 1 || type === 2) assertObjectPermissions(document, payload, userId);
  },

  async onChange({ documentName, update }) {
    await appendReplayUpdate(documentName, update);
    await security.touchBoard(documentName);
  },

  async onStoreDocument({ documentName, document }) {
    await writeSnapshot(documentName, document);
  },

  async onRequest({ request, response }) {
    metrics.requests += 1;
    const typedRequest = request as typeof request & { headers: Record<string, string | string[] | undefined> };
    const typedResponse = response as unknown as Response;
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    try {
      if (!rateLimit(typedRequest)) {
        metrics.denied += 1;
        sendJson(typedRequest, typedResponse, 429, { error: "Rate limit exceeded. Try again shortly." });
        throw null;
      }
      if (request.method === "OPTIONS") {
        sendJson(typedRequest, typedResponse, 204, {});
        throw null;
      }
      if (url.pathname === "/health") {
        sendJson(typedRequest, typedResponse, 200, { ok: true, service: "icanvas-sync", uptimeSeconds: Math.floor((Date.now() - metrics.startedAt) / 1000) });
        throw null;
      }
      if (url.pathname === "/metrics") {
        const key = request.headers["x-metrics-key"];
        if (process.env.SYNC_METRICS_KEY && key !== process.env.SYNC_METRICS_KEY) {
          sendJson(typedRequest, typedResponse, 401, { error: "Metrics authentication required." });
          throw null;
        }
        sendJson(typedRequest, typedResponse, 200, { ...metrics, boards: await security.boardCount() });
        throw null;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/register") {
        const body = await requestBody(request as never);
        const account = await security.register({ email: String(body.email ?? ""), name: String(body.name ?? ""), password: String(body.password ?? "") });
        const session = sessionFor(account);
        sendJson(typedRequest, typedResponse, 201, { token: createSessionToken(session, authSecret), user: { id: account.id, email: account.email, name: account.name } });
        throw null;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const body = await requestBody(request as never);
        const account = await security.authenticate(String(body.email ?? ""), String(body.password ?? ""));
        if (!account) {
          metrics.denied += 1;
          sendJson(typedRequest, typedResponse, 401, { error: "Invalid email or password." });
        } else {
          const session = sessionFor(account);
          sendJson(typedRequest, typedResponse, 200, { token: createSessionToken(session, authSecret), user: { id: account.id, email: account.email, name: account.name } });
        }
        throw null;
      }

      const session = bearer(typedRequest);
      if (!session) {
        metrics.denied += 1;
        sendJson(typedRequest, typedResponse, 401, { error: "Authentication required." });
        throw null;
      }
      if (request.method === "GET" && url.pathname === "/api/boards") {
        const boards = await security.listBoards(session.userId);
        sendJson(typedRequest, typedResponse, 200, { boards });
        throw null;
      }
      if (request.method === "POST" && url.pathname === "/api/boards") {
        const body = await requestBody(request as never);
        const board = await security.createBoard(session.userId, String(body.title ?? ""));
        sendJson(typedRequest, typedResponse, 201, { board });
        throw null;
      }
      if (request.method === "POST" && url.pathname === "/api/errors") {
        await reportError(await requestBody(request as never), session);
        sendJson(typedRequest, typedResponse, 202, { accepted: true });
        throw null;
      }

      const boardMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
      const replayMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/replay$/);
      const membersMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/members$/);
      const memberMatch = url.pathname.match(/^\/api\/boards\/([^/]+)\/members\/([^/]+)$/);
      if (request.method === "GET" && boardMatch) {
        const boardId = decodeURIComponent(boardMatch[1]);
        if (!(await requireBoardRole(typedRequest, boardId))) {
          metrics.denied += 1;
          sendJson(typedRequest, typedResponse, 403, { error: "Board access denied." });
        } else {
          sendJson(typedRequest, typedResponse, 200, { board: await security.getBoard(boardId) });
        }
        throw null;
      }
      if (request.method === "GET" && replayMatch) {
        const boardId = decodeURIComponent(replayMatch[1]);
        if (!(await requireBoardRole(typedRequest, boardId))) {
          metrics.denied += 1;
          sendJson(typedRequest, typedResponse, 403, { error: "Board access denied." });
        } else sendJson(typedRequest, typedResponse, 200, { updates: await readReplayUpdates(boardId) });
        throw null;
      }
      if (request.method === "POST" && membersMatch) {
        const boardId = decodeURIComponent(membersMatch[1]);
        const body = await requestBody(request as never);
        const board = await security.grant(boardId, session.userId, String(body.email ?? ""), body.role === "viewer" ? "viewer" : "editor");
        sendJson(typedRequest, typedResponse, 200, { board });
        throw null;
      }
      if (request.method === "DELETE" && memberMatch) {
        await security.remove(decodeURIComponent(memberMatch[1]), session.userId, decodeURIComponent(memberMatch[2]));
        sendJson(typedRequest, typedResponse, 204, {});
        throw null;
      }
      sendJson(typedRequest, typedResponse, 404, { error: "Not found" });
      throw null;
    } catch (error) {
      if (error === null) throw error;
      metrics.errors += 1;
      console.error("sync request failed", error);
      sendJson(typedRequest, typedResponse, 400, { error: error instanceof Error ? error.message : "Request failed." });
      throw null;
    }
  }
});

await mkdir(dataDir, { recursive: true });
await security.load();
server.listen().then(() => {
  console.log(`iCanvas sync server listening on ws://localhost:${port}`);
  console.log(`Secure replay API listening on http://localhost:${port}/api/boards/:boardId/replay`);
});
