import * as Y from "yjs";
import { BOARD_OBJECTS_KEY, type CanvasObject } from "@icanvas/shared";

function sameObject(left: CanvasObject | undefined, right: CanvasObject | undefined) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Enforces persisted object locks for incoming Yjs write updates. */
export function assertObjectPermissions(document: Y.Doc, update: Uint8Array, userId: string) {
  const before = document.getMap<CanvasObject>(BOARD_OBJECTS_KEY);
  const next = new Y.Doc();
  Y.applyUpdate(next, Y.encodeStateAsUpdate(document));
  Y.applyUpdate(next, update);
  const after = next.getMap<CanvasObject>(BOARD_OBJECTS_KEY);
  const ids = new Set([...before.keys(), ...after.keys()]);

  for (const id of ids) {
    const current = before.get(id);
    const proposed = after.get(id);
    if (sameObject(current, proposed)) continue;
    if (current?.lockedBy && current.lockedBy !== userId) throw new Error("This object is locked by another member.");
    if (!current && proposed?.createdBy !== userId) throw new Error("Objects must be created as the authenticated user.");
    if (proposed?.lockedBy && proposed.lockedBy !== userId) throw new Error("Objects can only be locked by their authenticated user.");
  }
}
