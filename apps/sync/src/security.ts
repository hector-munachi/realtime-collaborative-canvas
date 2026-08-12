import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export type BoardRole = "owner" | "editor" | "viewer";

export type Account = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: number;
};

export type BoardAccess = {
  userId: string;
  role: BoardRole;
  grantedAt: number;
};

export type SecureBoard = {
  id: string;
  title: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  members: BoardAccess[];
};

type SecurityData = { accounts: Account[]; boards: SecureBoard[] };

export type Session = { userId: string; email: string; name: string; expiresAt: number };

function id(prefix: string) {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSessionToken(session: Session, secret: string) {
  const payload = base64Url(JSON.stringify(session));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string, secret: string): Session | null {
  const [payload, signature] = token.split(".");

  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload, secret));
  const received = Buffer.from(signature);

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const session = JSON.parse(fromBase64Url(payload).toString("utf8")) as Session;
    return session.expiresAt > Date.now() && typeof session.userId === "string" ? session : null;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, encoded] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !encoded) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = fromBase64Url(encoded);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export class SecurityStore {
  private data: SecurityData = { accounts: [], boards: [] };
  private loaded = false;

  constructor(private readonly file: string) {}

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.file, "utf8");
      const value = JSON.parse(raw) as Partial<SecurityData>;
      this.data = { accounts: value.accounts ?? [], boards: value.boards ?? [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async persist() {
    await writeFile(this.file, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
  }

  async register(input: { email: string; name: string; password: string }) {
    await this.load();
    const email = input.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address.");
    if (input.password.length < 12) throw new Error("Password must be at least 12 characters.");
    if (this.data.accounts.some((account) => account.email === email)) throw new Error("An account already exists for that email.");

    const account: Account = {
      id: id("usr"),
      email,
      name: input.name.trim().slice(0, 80) || email.split("@")[0],
      passwordHash: await hashPassword(input.password),
      createdAt: Date.now()
    };
    this.data.accounts.push(account);
    await this.persist();
    return account;
  }

  async authenticate(email: string, password: string) {
    await this.load();
    const account = this.data.accounts.find((item) => item.email === email.trim().toLowerCase());
    if (!account || !(await verifyPassword(password, account.passwordHash))) return null;
    return account;
  }

  async createBoard(ownerId: string, title: string) {
    await this.load();
    const board: SecureBoard = {
      id: id("board"),
      title: title.trim().slice(0, 120) || "Untitled board",
      ownerId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      members: [{ userId: ownerId, role: "owner", grantedAt: Date.now() }]
    };
    this.data.boards.push(board);
    await this.persist();
    return board;
  }

  async getBoard(boardId: string) {
    await this.load();
    return this.data.boards.find((board) => board.id === boardId) ?? null;
  }

  async listBoards(userId: string) {
    await this.load();
    return this.data.boards
      .filter((board) => board.members.some((member) => member.userId === userId))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async boardCount() {
    await this.load();
    return this.data.boards.length;
  }

  async roleFor(boardId: string, userId: string): Promise<BoardRole | null> {
    const board = await this.getBoard(boardId);
    return board?.members.find((member) => member.userId === userId)?.role ?? null;
  }

  async grant(boardId: string, actorId: string, recipientEmail: string, role: Exclude<BoardRole, "owner">) {
    const board = await this.getBoard(boardId);
    if (!board || board.ownerId !== actorId) throw new Error("Only the board owner can manage access.");
    const account = this.data.accounts.find((item) => item.email === recipientEmail.trim().toLowerCase());
    if (!account) throw new Error("No iCanvas account exists for that email.");
    const current = board.members.find((member) => member.userId === account.id);
    if (current) current.role = role;
    else board.members.push({ userId: account.id, role, grantedAt: Date.now() });
    board.updatedAt = Date.now();
    await this.persist();
    return board;
  }

  async remove(boardId: string, actorId: string, memberId: string) {
    const board = await this.getBoard(boardId);
    if (!board || board.ownerId !== actorId || memberId === actorId) throw new Error("Only the board owner can remove other members.");
    board.members = board.members.filter((member) => member.userId !== memberId);
    board.updatedAt = Date.now();
    await this.persist();
  }

  async touchBoard(boardId: string) {
    const board = await this.getBoard(boardId);
    if (!board) return;
    board.updatedAt = Date.now();
    await this.persist();
  }

  async accountFor(userId: string) {
    await this.load();
    return this.data.accounts.find((account) => account.id === userId) ?? null;
  }
}

export function sessionFor(account: Account): Session {
  return { userId: account.id, email: account.email, name: account.name, expiresAt: Date.now() + TOKEN_TTL_MS };
}

export function securityFile(dataDir: string) {
  return path.join(dataDir, "security.json");
}
