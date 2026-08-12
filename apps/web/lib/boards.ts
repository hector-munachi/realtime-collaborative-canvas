import { createId } from "@icanvas/shared";

export type RecentBoard = {
  id: string;
  title: string;
  openedAt: number;
  accessKey?: string;
};

const RECENTS_KEY = "icanvas:recent-boards";

export function createBoardId() {
  return createId("board");
}

export function createBoardAccessKey() {
  return createId("key");
}

export function boardHref(boardId: string, accessKey?: string) {
  const base = `/boards/${encodeURIComponent(boardId)}`;
  return accessKey ? `${base}?key=${encodeURIComponent(accessKey)}` : base;
}

export function boardTitleFromId(boardId: string) {
  return boardId
    .replace(/^board_/, "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .slice(0, 36);
}

export function getRecentBoards(): RecentBoard[] {
  if (typeof window === "undefined") {
    return [];
  }

  const raw = window.localStorage.getItem(RECENTS_KEY);

  if (!raw) {
    return [];
  }

  try {
    return (JSON.parse(raw) as RecentBoard[]).sort((a, b) => b.openedAt - a.openedAt);
  } catch {
    window.localStorage.removeItem(RECENTS_KEY);
    return [];
  }
}

export function getStoredBoardAccessKey(boardId: string) {
  if (typeof window === "undefined") {
    return undefined;
  }

  return getRecentBoards().find((board) => board.id === boardId)?.accessKey;
}

export function rememberBoard(
  boardId: string,
  title = boardTitleFromId(boardId),
  accessKey?: string
) {
  if (typeof window === "undefined") {
    return;
  }

  const existing = getRecentBoards().find((board) => board.id === boardId);
  const next = [
    {
      id: boardId,
      title,
      openedAt: Date.now(),
      accessKey: accessKey ?? existing?.accessKey
    },
    ...getRecentBoards().filter((board) => board.id !== boardId)
  ].slice(0, 8);

  window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
}
