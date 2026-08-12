import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import {
  SecurityStore,
  createSessionToken,
  sessionFor,
  verifySessionToken
} from "../apps/sync/src/security.js";
import { assertObjectPermissions } from "../apps/sync/src/object-permissions.js";

test("account tokens and board roles protect sync access", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "icanvas-security-"));
  try {
    const store = new SecurityStore(path.join(directory, "security.json"));
    const owner = await store.register({ name: "Owner", email: "owner@example.test", password: "correct-horse-battery-staple" });
    const viewer = await store.register({ name: "Viewer", email: "viewer@example.test", password: "another-secure-password" });
    const board = await store.createBoard(owner.id, "Protected board");
    await store.grant(board.id, owner.id, viewer.email, "viewer");
    assert.equal(await store.roleFor(board.id, owner.id), "owner");
    assert.equal(await store.roleFor(board.id, viewer.id), "viewer");
    assert.equal(await store.roleFor(board.id, "attacker"), null);

    const token = createSessionToken(sessionFor(owner), "test-secret");
    assert.equal(verifySessionToken(token, "test-secret")?.userId, owner.id);
    assert.equal(verifySessionToken(`${token}x`, "test-secret"), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("offline Yjs edits merge and replay reproduces the shared board", () => {
  const first = new Y.Doc();
  const second = new Y.Doc();
  const objects = first.getMap<{ x: number; text: string }>("objects");
  const updates: Uint8Array[] = [];
  first.on("update", (update) => updates.push(update));
  objects.set("note-a", { x: 10, text: "offline note" });
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  second.getMap<{ x: number; text: string }>("objects").set("note-b", { x: 20, text: "remote note" });
  Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
  assert.equal(first.getMap("objects").size, 2);

  const replay = new Y.Doc();
  for (const update of updates) Y.applyUpdate(replay, update);
  assert.deepEqual(replay.getMap("objects").get("note-a"), { x: 10, text: "offline note" });
});

test("physics ownership is a single-writer shared field", () => {
  const document = new Y.Doc();
  const objects = document.getMap<{ physics: { ownerId?: string; active: boolean }; x: number }>("objects");
  objects.set("shape", { x: 0, physics: { ownerId: "client-a", active: true } });
  const object = objects.get("shape");
  assert.equal(object?.physics.ownerId, "client-a");
  // A peer renders the published position but must not take authority until it grabs the object.
  assert.notEqual(object?.physics.ownerId, "client-b");
  objects.set("shape", { x: 44, physics: { active: false } });
  assert.equal(objects.get("shape")?.physics.ownerId, undefined);
});

test("locked objects reject another editor's Yjs update", () => {
  const serverDocument = new Y.Doc();
  serverDocument.getMap("objects").set("note", { id: "note", type: "note", createdBy: "owner", lockedBy: "owner", text: "Private", x: 0, y: 0, width: 100, height: 60, color: "#fff", updatedAt: 1 });
  const attacker = new Y.Doc();
  Y.applyUpdate(attacker, Y.encodeStateAsUpdate(serverDocument));
  attacker.getMap("objects").set("note", { id: "note", type: "note", createdBy: "owner", lockedBy: "owner", text: "Changed", x: 0, y: 0, width: 100, height: 60, color: "#fff", updatedAt: 2 });
  const update = Y.encodeStateAsUpdate(attacker, Y.encodeStateVector(serverDocument));
  assert.throws(() => assertObjectPermissions(serverDocument, update, "editor"), /locked by another member/i);
});
