import * as Y from "yjs";
import {
  BOARD_OBJECTS_KEY,
  type CanvasObject,
  type ReplayUpdate
} from "@icanvas/shared";

export function decodeBase64Update(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function objectsAtReplayIndex(updates: ReplayUpdate[], index: number): CanvasObject[] {
  const replayDoc = new Y.Doc();
  const visibleUpdates = updates.slice(0, index + 1);

  for (const entry of visibleUpdates) {
    Y.applyUpdate(replayDoc, decodeBase64Update(entry.update));
  }

  return Array.from(replayDoc.getMap<CanvasObject>(BOARD_OBJECTS_KEY).values());
}
