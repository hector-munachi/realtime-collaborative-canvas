"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import Link from "next/link";
import {
  Download,
  Circle,
  Clipboard,
  Edit3,
  Home,
  MousePointer2,
  Navigation,
  Palette,
  Pause,
  Pencil,
  Play,
  Radio,
  RectangleHorizontal,
  RotateCcw,
  Share2,
  Sparkles,
  StickyNote,
  Trash2,
  Users,
  Wifi,
  WifiOff
} from "lucide-react";
import { Application, Container, Graphics, Text } from "pixi.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import {
  BOARD_META_KEY,
  BOARD_OBJECTS_KEY,
  clamp,
  createId,
  type AwarenessState,
  type BoardMetadata,
  type Camera,
  type CanvasObject,
  type CanvasTool,
  type Point,
  type ReplayUpdate
} from "@icanvas/shared";
import { boardHref, boardTitleFromId, getStoredBoardAccessKey, rememberBoard } from "../../lib/boards";
import { objectsAtReplayIndex } from "../../lib/replay";
import { cn } from "../../lib/utils";
import { getLocalUser, type LocalUser } from "../../lib/user";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

type DragState =
  | {
      mode: "draw";
      objectId: string;
    }
  | {
      mode: "shape";
      objectId: string;
      start: Point;
    }
  | {
      mode: "move";
      objectId: string;
      start: Point;
      original: CanvasObject;
    }
  | {
      mode: "resize";
      objectId: string;
      start: Point;
      original: CanvasObject;
    }
  | {
      mode: "pan";
      startScreen: Point;
      startCamera: Camera;
    };

type ConnectionState = "connecting" | "connected" | "disconnected";

const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL ?? "ws://localhost:1234";
const SYNC_HTTP_URL = process.env.NEXT_PUBLIC_SYNC_HTTP_URL ?? "http://localhost:1234";

const TOOL_CONFIG: Array<{
  tool: CanvasTool;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
}> = [
  { tool: "select", label: "Select or pan", icon: MousePointer2 },
  { tool: "draw", label: "Draw", icon: Pencil },
  { tool: "note", label: "Sticky note", icon: StickyNote },
  { tool: "rect", label: "Rectangle", icon: RectangleHorizontal },
  { tool: "ellipse", label: "Ellipse", icon: Circle }
];

const STROKE_COLORS = ["#1f1f1f", "#0f766e", "#2563eb", "#b45309", "#be123c", "#7c3aed"];
const NOTE_COLORS = ["#fbf3db", "#fdecc8", "#e9f5db", "#ddedea", "#e7f0fd", "#f4dfeb"];
const SHAPE_COLORS = ["#f1f1ef", "#ddedea", "#e7f0fd", "#fdecc8", "#f4dfeb", "#ede7f6"];

const CANVAS_BACKGROUND = "#fbfbfa";
const CANVAS_GRID = "#e3e2df";
const CANVAS_GRID_HEX = 0xdbe3eb;
const CANVAS_SELECTION_HEX = 0x111827;

function screenToWorld(point: Point, camera: Camera): Point {
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom
  };
}

function worldToScreen(point: Point, camera: Camera): Point {
  return {
    x: point.x * camera.zoom + camera.x,
    y: point.y * camera.zoom + camera.y
  };
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = clamp(
    ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) /
      lengthSquared,
    0,
    1
  );
  const projection = {
    x: start.x + t * (end.x - start.x),
    y: start.y + t * (end.y - start.y)
  };

  return Math.hypot(point.x - projection.x, point.y - projection.y);
}

function hitTestObject(object: CanvasObject, point: Point): boolean {
  if (object.type === "note" || object.type === "shape") {
    return (
      point.x >= object.x &&
      point.x <= object.x + object.width &&
      point.y >= object.y &&
      point.y <= object.y + object.height
    );
  }

  for (let index = 1; index < object.points.length; index += 1) {
    if (distanceToSegment(point, object.points[index - 1], object.points[index]) < object.width + 6) {
      return true;
    }
  }

  return false;
}

function findObjectAt(objects: CanvasObject[], point: Point): CanvasObject | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    if (hitTestObject(objects[index], point)) {
      return objects[index];
    }
  }

  return null;
}

function translateObject(object: CanvasObject, dx: number, dy: number): CanvasObject {
  if (object.type === "stroke") {
    return {
      ...object,
      points: object.points.map((point) => ({
        x: point.x + dx,
        y: point.y + dy
      })),
      updatedAt: Date.now()
    };
  }

  return {
    ...object,
    x: object.x + dx,
    y: object.y + dy,
    updatedAt: Date.now()
  };
}

function normalizeShape(start: Point, current: Point) {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.max(24, Math.abs(current.x - start.x)),
    height: Math.max(24, Math.abs(current.y - start.y))
  };
}

function objectBounds(object: CanvasObject) {
  if (object.type === "stroke") {
    const xs = object.points.map((point) => point.x);
    const ys = object.points.map((point) => point.y);

    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys)
    };
  }

  return {
    minX: object.x,
    minY: object.y,
    maxX: object.x + object.width,
    maxY: object.y + object.height
  };
}

function boardBounds(objects: CanvasObject[], camera: Camera, viewportWidth: number, viewportHeight: number) {
  const viewport = {
    minX: -camera.x / camera.zoom,
    minY: -camera.y / camera.zoom,
    maxX: (viewportWidth - camera.x) / camera.zoom,
    maxY: (viewportHeight - camera.y) / camera.zoom
  };

  const bounds = objects.reduce(
    (current, object) => {
      const next = objectBounds(object);

      return {
        minX: Math.min(current.minX, next.minX),
        minY: Math.min(current.minY, next.minY),
        maxX: Math.max(current.maxX, next.maxX),
        maxY: Math.max(current.maxY, next.maxY)
      };
    },
    viewport
  );

  const padding = 240;

  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding
  };
}

function boardDocumentName(boardId: string, accessKey?: string) {
  return accessKey ? `${boardId}__${accessKey}` : boardId;
}

function slugify(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "icanvas-board";
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  textValue: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxHeight: number
) {
  const paragraphs = textValue.split("\n");
  let currentY = y;

  for (const paragraph of paragraphs) {
    const words = paragraph.split(" ");
    let line = "";

    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;

      if (context.measureText(testLine).width > maxWidth && line) {
        if (currentY + lineHeight > y + maxHeight) {
          return;
        }

        context.fillText(line, x, currentY);
        currentY += lineHeight;
        line = word;
      } else {
        line = testLine;
      }
    }

    if (currentY + lineHeight > y + maxHeight) {
      return;
    }

    context.fillText(line, x, currentY);
    currentY += lineHeight;
  }
}

function exportObjectsToPng(objects: CanvasObject[], title: string) {
  const fallbackCamera = { x: 0, y: 0, zoom: 1 };
  const bounds = boardBounds(objects, fallbackCamera, 1200, 760);
  const padding = 96;
  const boardWidth = Math.max(1, bounds.maxX - bounds.minX);
  const boardHeight = Math.max(1, bounds.maxY - bounds.minY);
  const maxWidth = 2600;
  const maxHeight = 1800;
  const scale = Math.min(2, maxWidth / (boardWidth + padding * 2), maxHeight / (boardHeight + padding * 2));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((boardWidth + padding * 2) * scale);
  canvas.height = Math.ceil((boardHeight + padding * 2) * scale);

  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  const toCanvas = (point: Point) => ({
    x: (point.x - bounds.minX + padding) * scale,
    y: (point.y - bounds.minY + padding) * scale
  });

  context.fillStyle = CANVAS_BACKGROUND;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = CANVAS_GRID;
  context.lineWidth = 1;
  const gridSize = 80;
  const startX = Math.floor(bounds.minX / gridSize) * gridSize;
  const endX = Math.ceil(bounds.maxX / gridSize) * gridSize;
  const startY = Math.floor(bounds.minY / gridSize) * gridSize;
  const endY = Math.ceil(bounds.maxY / gridSize) * gridSize;

  for (let x = startX; x <= endX; x += gridSize) {
    const from = toCanvas({ x, y: bounds.minY });
    const to = toCanvas({ x, y: bounds.maxY });
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  for (let y = startY; y <= endY; y += gridSize) {
    const from = toCanvas({ x: bounds.minX, y });
    const to = toCanvas({ x: bounds.maxX, y });
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  for (const object of objects) {
    if (object.type === "stroke") {
      if (object.points.length === 0) {
        continue;
      }

      context.strokeStyle = object.color;
      context.lineWidth = object.width * scale;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      const first = toCanvas(object.points[0]);
      context.moveTo(first.x, first.y);

      for (const point of object.points.slice(1)) {
        const next = toCanvas(point);
        context.lineTo(next.x, next.y);
      }

      context.stroke();
      continue;
    }

    const topLeft = toCanvas({ x: object.x, y: object.y });
    const width = object.width * scale;
    const height = object.height * scale;

    context.lineWidth = 2 * scale;

    if (object.type === "note") {
      context.fillStyle = object.color;
      context.strokeStyle = "#b8a45b";
      context.beginPath();
      context.roundRect(topLeft.x, topLeft.y, width, height, 8 * scale);
      context.fill();
      context.stroke();
      context.fillStyle = "#1f1f1f";
      context.font = `${16 * scale}px Inter, Arial, sans-serif`;
      wrapCanvasText(
        context,
        object.text,
        topLeft.x + 12 * scale,
        topLeft.y + 28 * scale,
        width - 24 * scale,
        22 * scale,
        height - 24 * scale
      );
      continue;
    }

    context.fillStyle = object.fill;
    context.strokeStyle = object.stroke;
    context.beginPath();

    if (object.shape === "ellipse") {
      context.ellipse(topLeft.x + width / 2, topLeft.y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    } else {
      context.roundRect(topLeft.x, topLeft.y, width, height, 6 * scale);
    }

    context.fill();
    context.stroke();
  }

  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `${slugify(title)}-full-board.png`;
  link.click();
}

function createDemoObjects(user: LocalUser): CanvasObject[] {
  const now = Date.now();
  const author = user.id;

  return [
    {
      id: createId("note"),
      type: "note",
      x: -460,
      y: -180,
      width: 260,
      height: 150,
      text: "Demo goal\n\nKeep drawing offline, reconnect, and replay the thinking.",
      color: "#fbf3db",
      createdBy: author,
      updatedAt: now
    },
    {
      id: createId("note"),
      type: "note",
      x: -120,
      y: -260,
      width: 240,
      height: 130,
      text: "1. Create board\n2. Share link\n3. Collaborate live",
      color: "#ddedea",
      createdBy: author,
      updatedAt: now + 1
    },
    {
      id: createId("note"),
      type: "note",
      x: 220,
      y: -150,
      width: 250,
      height: 140,
      text: "Judge moment\n\nPull the network, keep editing, reconnect, then scrub replay.",
      color: "#e7f0fd",
      createdBy: author,
      updatedAt: now + 2
    },
    {
      id: createId("shape"),
      type: "shape",
      shape: "rect",
      x: -340,
      y: 120,
      width: 220,
      height: 92,
      fill: "#f1f1ef",
      stroke: "#787774",
      createdBy: author,
      updatedAt: now + 3
    },
    {
      id: createId("shape"),
      type: "shape",
      shape: "ellipse",
      x: 60,
      y: 92,
      width: 220,
      height: 110,
      fill: "#f4dfeb",
      stroke: "#be123c",
      createdBy: author,
      updatedAt: now + 4
    },
    {
      id: createId("stroke"),
      type: "stroke",
      points: [
        { x: -110, y: -20 },
        { x: -50, y: 20 },
        { x: 20, y: 34 },
        { x: 96, y: 20 },
        { x: 170, y: -10 }
      ],
      color: "#1f1f1f",
      width: 5,
      createdBy: author,
      updatedAt: now + 5
    }
  ];
}

function toHexNumber(color: string): number {
  return Number.parseInt(color.replace("#", ""), 16);
}

function drawObjects(
  stage: Container,
  objects: CanvasObject[],
  selectedId: string | null,
  camera: Camera
) {
  stage.removeChildren();
  stage.x = camera.x;
  stage.y = camera.y;
  stage.scale.set(camera.zoom);

  const grid = new Graphics();
  grid.alpha = 0.28;

  const gridSize = 80;
  const gridExtent = 8000;

  for (let x = -gridExtent; x <= gridExtent; x += gridSize) {
    grid.moveTo(x, -gridExtent);
    grid.lineTo(x, gridExtent);
  }

  for (let y = -gridExtent; y <= gridExtent; y += gridSize) {
    grid.moveTo(-gridExtent, y);
    grid.lineTo(gridExtent, y);
  }

  grid.stroke({ color: CANVAS_GRID_HEX, width: 1 });
  stage.addChild(grid);

  for (const object of objects) {
    const graphic = new Graphics();

    if (object.type === "stroke") {
      if (object.points.length > 0) {
        graphic.moveTo(object.points[0].x, object.points[0].y);

        for (const point of object.points.slice(1)) {
          graphic.lineTo(point.x, point.y);
        }

        graphic.stroke({
          color: toHexNumber(object.color),
          width: object.width,
          cap: "round",
          join: "round"
        });
      }
    }

    if (object.type === "note") {
      graphic.roundRect(object.x, object.y, object.width, object.height, 8);
      graphic.fill({ color: toHexNumber(object.color), alpha: 1 });
      graphic.stroke({
        color: selectedId === object.id ? CANVAS_SELECTION_HEX : 0xd69e2e,
        width: selectedId === object.id ? 3 : 1
      });

      const label = new Text({
        text: object.text,
        style: {
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 16,
          fill: 0x111827,
          wordWrap: true,
          wordWrapWidth: object.width - 24,
          lineHeight: 22
        }
      });

      label.x = object.x + 12;
      label.y = object.y + 12;
      stage.addChild(graphic, label);
      continue;
    }

    if (object.type === "shape") {
      if (object.shape === "rect") {
        graphic.roundRect(object.x, object.y, object.width, object.height, 6);
      } else {
        graphic.ellipse(
          object.x + object.width / 2,
          object.y + object.height / 2,
          object.width / 2,
          object.height / 2
        );
      }

      graphic.fill({ color: toHexNumber(object.fill), alpha: 0.8 });
      graphic.stroke({
        color: selectedId === object.id ? CANVAS_SELECTION_HEX : toHexNumber(object.stroke),
        width: selectedId === object.id ? 3 : 2
      });
    }

    stage.addChild(graphic);
  }
}

export function CanvasWorkspace({
  boardId,
  initialAccessKey
}: {
  boardId: string;
  initialAccessKey?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const stageRef = useRef<Container | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const objectsMapRef = useRef<Y.Map<CanvasObject> | null>(null);
  const metaMapRef = useRef<Y.Map<BoardMetadata[keyof BoardMetadata]> | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const objectsRef = useRef<CanvasObject[]>([]);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const localUserRef = useRef<LocalUser | null>(null);

  const [tool, setTool] = useState<CanvasTool>("select");
  const [objects, setObjects] = useState<CanvasObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [offlineReady, setOfflineReady] = useState(false);
  const [awarenessStates, setAwarenessStates] = useState<Array<[number, AwarenessState]>>([]);
  const [replayUpdates, setReplayUpdates] = useState<ReplayUpdate[]>([]);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<{ id: string; text: string } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [exportCopied, setExportCopied] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [boardMeta, setBoardMeta] = useState<BoardMetadata>({});
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [accessKey] = useState(() => {
    if (initialAccessKey) {
      return initialAccessKey;
    }

    if (typeof window !== "undefined") {
      return getStoredBoardAccessKey(boardId) ?? "";
    }

    return "";
  });
  const [replayPlaying, setReplayPlaying] = useState(false);

  const fallbackBoardTitle = useMemo(() => boardTitleFromId(boardId), [boardId]);
  const boardTitle = boardMeta.title?.trim() || fallbackBoardTitle;
  const documentName = useMemo(() => boardDocumentName(boardId, accessKey), [accessKey, boardId]);

  const renderedObjects = useMemo(() => {
    if (replayIndex === null || replayUpdates.length === 0) {
      return objects;
    }

    return objectsAtReplayIndex(replayUpdates, replayIndex);
  }, [objects, replayIndex, replayUpdates]);

  const selectedObject = useMemo(
    () => objects.find((object) => object.id === selectedId) ?? null,
    [objects, selectedId]
  );

  const selectedNotePosition = useMemo(() => {
    if (!editingNote) {
      return null;
    }

    const note = objects.find((object) => object.id === editingNote.id);

    if (note?.type !== "note") {
      return null;
    }

    const screen = worldToScreen({ x: note.x, y: note.y }, camera);

    return {
      note,
      left: screen.x,
      top: screen.y,
      width: note.width * camera.zoom,
      height: note.height * camera.zoom
    };
  }, [camera, editingNote, objects]);

  const selectedBoxPosition = useMemo(() => {
    if (!selectedObject || selectedObject.type === "stroke" || editingNote) {
      return null;
    }

    const screen = worldToScreen({ x: selectedObject.x, y: selectedObject.y }, camera);

    return {
      object: selectedObject,
      left: screen.x,
      top: screen.y,
      width: selectedObject.width * camera.zoom,
      height: selectedObject.height * camera.zoom
    };
  }, [camera, editingNote, selectedObject]);

  const minimap = useMemo(() => {
    const container = containerRef.current;
    const width = 216;
    const height = 132;

    if (!container) {
      return null;
    }

    const bounds = boardBounds(renderedObjects, camera, container.clientWidth, container.clientHeight);
    const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
    const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min(width / worldWidth, height / worldHeight);
    const offsetX = (width - worldWidth * scale) / 2;
    const offsetY = (height - worldHeight * scale) / 2;

    const toMini = (point: Point) => ({
      x: (point.x - bounds.minX) * scale + offsetX,
      y: (point.y - bounds.minY) * scale + offsetY
    });

    return {
      width,
      height,
      bounds,
      scale,
      toMini,
      viewport: {
        x: offsetX + (-camera.x / camera.zoom - bounds.minX) * scale,
        y: offsetY + (-camera.y / camera.zoom - bounds.minY) * scale,
        width: (container.clientWidth / camera.zoom) * scale,
        height: (container.clientHeight / camera.zoom) * scale
      }
    };
  }, [camera, renderedObjects]);

  useEffect(() => {
    rememberBoard(boardId, boardTitle, accessKey || undefined);
  }, [accessKey, boardId, boardTitle]);

  useEffect(() => {
    setTitleDraft(boardTitle);
  }, [boardTitle]);

  useEffect(() => {
    const updateOnlineState = () => {
      setBrowserOnline(window.navigator.onLine);
    };

    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);

    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  const publishViewport = useCallback(() => {
    const provider = providerRef.current;
    const container = containerRef.current;

    if (!provider || !container) {
      return;
    }

    if (!provider.awareness) {
      return;
    }

    const current = cameraRef.current;
    provider.awareness.setLocalStateField("viewport", {
      ...current,
      width: container.clientWidth,
      height: container.clientHeight
    });
  }, []);

  useEffect(() => {
    publishViewport();
  }, [camera, publishViewport]);

  useEffect(() => {
    const user = getLocalUser();
    localUserRef.current = user;

    const ydoc = new Y.Doc();
    const objectsMap = ydoc.getMap<CanvasObject>(BOARD_OBJECTS_KEY);
    const metaMap = ydoc.getMap<BoardMetadata[keyof BoardMetadata]>(BOARD_META_KEY);
    ydocRef.current = ydoc;
    objectsMapRef.current = objectsMap;
    metaMapRef.current = metaMap;

    const syncObjects = () => {
      setObjects(Array.from(objectsMap.values()));
    };

    const syncMeta = () => {
      setBoardMeta({
        title: typeof metaMap.get("title") === "string" ? (metaMap.get("title") as string) : undefined,
        seededDemoAt:
          typeof metaMap.get("seededDemoAt") === "number"
            ? (metaMap.get("seededDemoAt") as number)
            : undefined,
        updatedAt:
          typeof metaMap.get("updatedAt") === "number" ? (metaMap.get("updatedAt") as number) : undefined
      });
    };

    objectsMap.observe(syncObjects);
    metaMap.observe(syncMeta);
    syncObjects();
    syncMeta();

    const provider = new HocuspocusProvider({
      url: SYNC_URL,
      name: documentName,
      document: ydoc,
      onStatus: ({ status }) => {
        setConnection(status === "connected" ? "connected" : "disconnected");
      }
    });

    providerRef.current = provider;
    const awareness = provider.awareness;

    if (!awareness) {
      return () => {
        objectsMap.unobserve(syncObjects);
        metaMap.unobserve(syncMeta);
        provider.destroy();
        ydoc.destroy();
      };
    }

    awareness.setLocalStateField("user", user);

    const updateAwareness = () => {
      setAwarenessStates(
        Array.from(awareness.getStates().entries()).filter(([clientId]) => {
          return clientId !== ydoc.clientID;
        }) as Array<[number, AwarenessState]>
      );
    };

    awareness.on("change", updateAwareness);
    updateAwareness();

    let indexedDbProvider: {
      on: (event: "synced", callback: () => void) => void;
      destroy: () => Promise<void> | void;
    } | null = null;

    import("y-indexeddb").then(({ IndexeddbPersistence }) => {
      indexedDbProvider = new IndexeddbPersistence(documentName, ydoc);
      indexedDbProvider.on("synced", () => {
        setOfflineReady(true);
      });
    });

    return () => {
      objectsMap.unobserve(syncObjects);
      metaMap.unobserve(syncMeta);
      awareness.off("change", updateAwareness);
      provider.destroy();
      void indexedDbProvider?.destroy();
      ydoc.destroy();
    };
  }, [documentName]);

  useEffect(() => {
    let disposed = false;

    async function mountPixi() {
      const container = containerRef.current;

      if (!container) {
        return;
      }

      const app = new Application();
      await app.init({
        backgroundAlpha: 0,
        antialias: true,
        resizeTo: container
      });

      if (disposed) {
        app.destroy(true);
        return;
      }

      app.canvas.className = "canvas-surface";
      container.appendChild(app.canvas);

      const stage = new Container();
      app.stage.addChild(stage);
      appRef.current = app;
      stageRef.current = stage;

      app.canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        const rect = app.canvas.getBoundingClientRect();
        const screenPoint = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        };
        const before = screenToWorld(screenPoint, cameraRef.current);
        const nextZoom = clamp(cameraRef.current.zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.2, 3.5);
        const nextCamera = {
          zoom: nextZoom,
          x: screenPoint.x - before.x * nextZoom,
          y: screenPoint.y - before.y * nextZoom
        };
        setCamera(nextCamera);
      });
    }

    void mountPixi();

    return () => {
      disposed = true;
      appRef.current?.destroy(true, { children: true });
      appRef.current = null;
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (stageRef.current) {
      drawObjects(stageRef.current, renderedObjects, selectedId, camera);
    }
  }, [camera, renderedObjects, selectedId]);

  useEffect(() => {
    if (!replayPlaying || !replayOpen || replayUpdates.length === 0) {
      return;
    }

    const interval = window.setInterval(() => {
      setReplayIndex((current) => {
        const next = current === null ? 0 : current + 1;

        if (next >= replayUpdates.length) {
          setReplayPlaying(false);
          return replayUpdates.length - 1;
        }

        return next;
      });
    }, 650);

    return () => {
      window.clearInterval(interval);
    };
  }, [replayOpen, replayPlaying, replayUpdates.length]);

  const upsertObject = useCallback((object: CanvasObject) => {
    objectsMapRef.current?.set(object.id, object);
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selectedId) {
      return;
    }

    objectsMapRef.current?.delete(selectedId);
    setSelectedId(null);
    setEditingNote(null);
  }, [selectedId]);

  const updateSelectedObject = useCallback(
    (patch: Partial<CanvasObject>) => {
      if (!selectedId) {
        return;
      }

      const object = objectsMapRef.current?.get(selectedId);

      if (!object) {
        return;
      }

      upsertObject({
        ...object,
        ...patch,
        updatedAt: Date.now()
      } as CanvasObject);
    },
    [selectedId, upsertObject]
  );

  const commitEditingNote = useCallback(() => {
    if (!editingNote) {
      return;
    }

    const object = objectsMapRef.current?.get(editingNote.id);

    if (object?.type === "note") {
      upsertObject({
        ...object,
        text: editingNote.text.trim() || "Untitled note",
        updatedAt: Date.now()
      });
    }

    setEditingNote(null);
  }, [editingNote, upsertObject]);

  const copyShareLink = useCallback(async () => {
    const href =
      typeof window === "undefined"
        ? boardHref(boardId, accessKey || undefined)
        : `${window.location.origin}${boardHref(boardId, accessKey || undefined)}`;

    await navigator.clipboard.writeText(href);
    setShareCopied(true);
    window.setTimeout(() => {
      setShareCopied(false);
    }, 1800);
  }, [accessKey, boardId]);

  const commitTitle = useCallback(() => {
    const title = titleDraft.trim() || fallbackBoardTitle;
    metaMapRef.current?.set("title", title);
    metaMapRef.current?.set("updatedAt", Date.now());
    rememberBoard(boardId, title, accessKey || undefined);
    setIsEditingTitle(false);
  }, [accessKey, boardId, fallbackBoardTitle, titleDraft]);

  const seedDemoBoard = useCallback(() => {
    const user = localUserRef.current;

    if (!user || !objectsMapRef.current) {
      return;
    }

    const doc = ydocRef.current;
    const seed = () => {
      for (const object of createDemoObjects(user)) {
        objectsMapRef.current?.set(object.id, object);
      }

      metaMapRef.current?.set("title", "Offline workshop demo");
      metaMapRef.current?.set("seededDemoAt", Date.now());
      metaMapRef.current?.set("updatedAt", Date.now());
    };

    if (doc) {
      doc.transact(seed);
    } else {
      seed();
    }

    const container = containerRef.current;

    if (container) {
      setCamera({
        x: container.clientWidth / 2,
        y: container.clientHeight / 2,
        zoom: 0.95
      });
    }
  }, []);

  const resetDemoBoard = useCallback(() => {
    if (!window.confirm("Reset this board to the demo content? This clears the current objects.")) {
      return;
    }

    const user = localUserRef.current;

    if (!user || !objectsMapRef.current) {
      return;
    }

    const reset = () => {
      objectsMapRef.current?.clear();

      for (const object of createDemoObjects(user)) {
        objectsMapRef.current?.set(object.id, object);
      }

      metaMapRef.current?.set("title", "Offline workshop demo");
      metaMapRef.current?.set("seededDemoAt", Date.now());
      metaMapRef.current?.set("updatedAt", Date.now());
    };

    ydocRef.current?.transact(reset);
    setSelectedId(null);
    setEditingNote(null);

    const container = containerRef.current;

    if (container) {
      setCamera({
        x: container.clientWidth / 2,
        y: container.clientHeight / 2,
        zoom: 0.95
      });
    }
  }, []);

  const exportBoardPng = useCallback(() => {
    exportObjectsToPng(objects, boardTitle);

    setExportCopied(true);
    window.setTimeout(() => {
      setExportCopied(false);
    }, 1800);
  }, [boardTitle, objects]);

  const jumpMinimap = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (!minimap || !containerRef.current) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const worldWidth = minimap.bounds.maxX - minimap.bounds.minX;
      const worldHeight = minimap.bounds.maxY - minimap.bounds.minY;
      const offsetX = (minimap.width - worldWidth * minimap.scale) / 2;
      const offsetY = (minimap.height - worldHeight * minimap.scale) / 2;
      const miniPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
      const world = {
        x: (miniPoint.x - offsetX) / minimap.scale + minimap.bounds.minX,
        y: (miniPoint.y - offsetY) / minimap.scale + minimap.bounds.minY
      };
      const container = containerRef.current;

      setCamera({
        zoom: cameraRef.current.zoom,
        x: container.clientWidth / 2 - world.x * cameraRef.current.zoom,
        y: container.clientHeight / 2 - world.y * cameraRef.current.zoom
      });
    },
    [minimap]
  );

  const getPointerPosition = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const screenPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };

    return {
      screen: screenPoint,
      world: screenToWorld(screenPoint, cameraRef.current)
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (replayIndex !== null) {
        return;
      }

      const user = localUserRef.current;
      const { screen, world } = getPointerPosition(event);
      event.currentTarget.setPointerCapture(event.pointerId);

      if (!user) {
        return;
      }

      if (tool === "draw") {
        const object: CanvasObject = {
          id: createId("stroke"),
          type: "stroke",
          points: [world],
          color: user.color,
          width: 4,
          createdBy: user.id,
          updatedAt: Date.now()
        };
        upsertObject(object);
        dragRef.current = { mode: "draw", objectId: object.id };
        setSelectedId(object.id);
        return;
      }

      if (tool === "note") {
        const object: CanvasObject = {
          id: createId("note"),
          type: "note",
          x: world.x,
          y: world.y,
          width: 220,
          height: 132,
          text: "New idea",
          color: "#fef08a",
          createdBy: user.id,
          updatedAt: Date.now()
        };
        upsertObject(object);
        setSelectedId(object.id);
        setEditingNote({ id: object.id, text: object.text });
        setTool("select");
        return;
      }

      if (tool === "rect" || tool === "ellipse") {
        const object: CanvasObject = {
          id: createId("shape"),
          type: "shape",
          shape: tool === "rect" ? "rect" : "ellipse",
          x: world.x,
          y: world.y,
          width: 24,
          height: 24,
          fill: tool === "rect" ? "#bfdbfe" : "#bbf7d0",
          stroke: tool === "rect" ? "#2563eb" : "#16a34a",
          createdBy: user.id,
          updatedAt: Date.now()
        };
        upsertObject(object);
        dragRef.current = { mode: "shape", objectId: object.id, start: world };
        setSelectedId(object.id);
        return;
      }

      const hitObject = findObjectAt(objectsRef.current, world);

      if (hitObject) {
        setSelectedId(hitObject.id);
        setEditingNote(null);
        dragRef.current = {
          mode: "move",
          objectId: hitObject.id,
          start: world,
          original: hitObject
        };
        return;
      }

      setSelectedId(null);
      setEditingNote(null);
      dragRef.current = {
        mode: "pan",
        startScreen: screen,
        startCamera: cameraRef.current
      };
    },
    [getPointerPosition, replayIndex, tool, upsertObject]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const { screen, world } = getPointerPosition(event);
      providerRef.current?.awareness?.setLocalStateField("cursor", world);

      const drag = dragRef.current;

      if (!drag || replayIndex !== null) {
        return;
      }

      if (drag.mode === "draw") {
        const object = objectsMapRef.current?.get(drag.objectId);

        if (object?.type !== "stroke") {
          return;
        }

        const lastPoint = object.points.at(-1);

        if (lastPoint && Math.hypot(lastPoint.x - world.x, lastPoint.y - world.y) < 2) {
          return;
        }

        upsertObject({
          ...object,
          points: [...object.points, world],
          updatedAt: Date.now()
        });
      }

      if (drag.mode === "shape") {
        const object = objectsMapRef.current?.get(drag.objectId);

        if (object?.type !== "shape") {
          return;
        }

        upsertObject({
          ...object,
          ...normalizeShape(drag.start, world),
          updatedAt: Date.now()
        });
      }

      if (drag.mode === "move") {
        upsertObject(translateObject(drag.original, world.x - drag.start.x, world.y - drag.start.y));
      }

      if (drag.mode === "resize") {
        const object = drag.original;

        if (object.type === "note" || object.type === "shape") {
          upsertObject({
            ...object,
            width: Math.max(64, object.width + world.x - drag.start.x),
            height: Math.max(48, object.height + world.y - drag.start.y),
            updatedAt: Date.now()
          });
        }
      }

      if (drag.mode === "pan") {
        setCamera({
          zoom: drag.startCamera.zoom,
          x: drag.startCamera.x + screen.x - drag.startScreen.x,
          y: drag.startCamera.y + screen.y - drag.startScreen.y
        });
      }
    },
    [getPointerPosition, replayIndex, upsertObject]
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (replayIndex !== null) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const world = screenToWorld(
        {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        },
        cameraRef.current
      );
      const object = findObjectAt(objectsRef.current, world);

      if (object?.type !== "note") {
        return;
      }

      setSelectedId(object.id);
      setEditingNote({ id: object.id, text: object.text });
    },
    [replayIndex]
  );

  const loadReplay = useCallback(async () => {
    const response = await fetch(`${SYNC_HTTP_URL}/api/boards/${encodeURIComponent(documentName)}/replay`);

    if (!response.ok) {
      throw new Error("Replay log is not available yet.");
    }

    const payload = (await response.json()) as { updates: ReplayUpdate[] };
    setReplayUpdates(payload.updates);
    setReplayIndex(payload.updates.length > 0 ? 0 : null);
    setReplayPlaying(false);
    setReplayOpen(true);
  }, [documentName]);

  const activeReplayTimestamp =
    replayIndex !== null && replayUpdates[replayIndex]
      ? new Date(replayUpdates[replayIndex].timestamp).toLocaleTimeString()
      : null;

  return (
    <main className="grid h-screen grid-rows-[56px_minmax(0,1fr)] overflow-hidden bg-background text-foreground">
      <header className="z-20 flex items-center justify-between border-b bg-background/95 px-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild variant="ghost" size="icon" title="Home" aria-label="Home">
            <Link href="/">
              <Home className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-xs font-bold text-background">
            iC
          </div>
          <div className="min-w-0">
            {isEditingTitle ? (
              <input
                className="h-7 w-[min(280px,42vw)] rounded-md border bg-card px-2 text-sm font-semibold outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring"
                value={titleDraft}
                autoFocus
                onChange={(event) => setTitleDraft(event.currentTarget.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitTitle();
                  }

                  if (event.key === "Escape") {
                    setTitleDraft(boardTitle);
                    setIsEditingTitle(false);
                  }
                }}
              />
            ) : (
              <button
                className="flex max-w-[42vw] items-center gap-1 truncate rounded-md text-left text-sm font-semibold leading-none outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                type="button"
                onClick={() => setIsEditingTitle(true)}
              >
                <span className="truncate">{boardTitle}</span>
                <Edit3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            )}
            <p className="mt-1 truncate text-xs text-muted-foreground">{boardId}</p>
          </div>
        </div>

        <div
          className="hidden items-center gap-1 rounded-lg border bg-card p-1 shadow-sm md:flex"
          role="toolbar"
          aria-label="Tools"
        >
          {TOOL_CONFIG.map((item) => {
            const Icon = item.icon;

            return (
              <Button
                key={item.tool}
                className={cn(tool === item.tool && "bg-accent text-accent-foreground")}
                variant="ghost"
                size="icon"
                title={item.label}
                aria-label={item.label}
                type="button"
                onClick={() => {
                  setTool(item.tool);
                  setReplayIndex(null);
                }}
              >
                <Icon className="h-4 w-4" />
              </Button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant={connection === "connected" ? "success" : "muted"}
            className="hidden gap-1.5 sm:inline-flex"
          >
            {connection === "connected" ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {connection}
          </Badge>
          <Badge variant={offlineReady ? "success" : "muted"} className="hidden gap-1.5 lg:inline-flex">
            <Radio className="h-3.5 w-3.5" />
            {offlineReady ? "offline ready" : "local cache"}
          </Badge>
          <Badge variant={accessKey ? "success" : "muted"} className="hidden gap-1.5 xl:inline-flex">
            {accessKey ? "keyed link" : "public demo"}
          </Badge>
          <Button variant="outline" size="sm" type="button" onClick={copyShareLink}>
            {shareCopied ? <Clipboard className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
            <span className="hidden sm:inline">{shareCopied ? "Copied" : "Share"}</span>
          </Button>
          <Button variant="outline" size="sm" type="button" onClick={exportBoardPng}>
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{exportCopied ? "Exported" : "Export"}</span>
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section
          ref={containerRef}
          className={cn(
            "relative min-h-0 touch-none overflow-hidden bg-[#fbfbfa]",
            replayIndex !== null ? "cursor-default" : "cursor-crosshair"
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        >
          <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
            {awarenessStates.map(([clientId, state]) => {
              if (!state.cursor || !state.user) {
                return null;
              }

              const screen = worldToScreen(state.cursor, camera);

              return (
                <div
                  key={clientId}
                  className="remote-cursor"
                  style={{
                    transform: `translate(${screen.x}px, ${screen.y}px)`,
                    color: state.user.color
                  }}
                >
                  <span className="cursor-point" />
                  <span className="ml-2 mt-0.5 inline-block max-w-40 truncate rounded-md px-2 py-1 text-xs leading-none text-white [background:currentColor]">
                    {state.user.name}
                  </span>
                </div>
              );
            })}
          </div>

          <div
            className="absolute left-4 top-4 z-10 flex rounded-lg border bg-card p-1 shadow-sm md:hidden"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {TOOL_CONFIG.map((item) => {
              const Icon = item.icon;

              return (
                <Button
                  key={item.tool}
                  className={cn(tool === item.tool && "bg-accent text-accent-foreground")}
                  variant="ghost"
                  size="icon"
                  title={item.label}
                  aria-label={item.label}
                  type="button"
                  onClick={() => {
                    setTool(item.tool);
                    setReplayIndex(null);
                  }}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              );
            })}
          </div>

          {!browserOnline || connection !== "connected" ? (
            <div
              className="absolute left-1/2 top-4 z-20 w-[min(460px,calc(100%-32px))] -translate-x-1/2 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <WifiOff className="mt-0.5 h-4 w-4 text-amber-700" />
                <div>
                  <p className="font-medium">
                    {!browserOnline ? "Browser is offline" : "Sync server reconnecting"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Keep editing. iCanvas stores changes locally and merges them when the connection
                    returns.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {objects.length === 0 && replayIndex === null ? (
            <div
              className="absolute left-1/2 top-1/2 z-10 w-[min(460px,calc(100%-40px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card/95 p-5 text-center shadow-sm"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <h2 className="text-base font-semibold">Start anywhere</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Draw a first stroke, drop a note, or share the board link and let the room build it
                together.
              </p>
              <div className="mt-4 flex justify-center">
                <Button type="button" variant="outline" onClick={seedDemoBoard}>
                  <Sparkles className="h-4 w-4" />
                  Seed demo board
                </Button>
              </div>
            </div>
          ) : null}

          {selectedNotePosition ? (
            <textarea
              className="absolute z-20 resize-none rounded-md border border-[#d6c06d] bg-[#fbf3db] p-3 text-sm leading-6 text-[#1f1f1f] caret-[#1f1f1f] shadow-lg outline-none ring-2 ring-ring placeholder:text-[#787774]"
              style={{
                left: selectedNotePosition.left,
                top: selectedNotePosition.top,
                width: Math.max(180, selectedNotePosition.width),
                height: Math.max(110, selectedNotePosition.height)
              }}
              value={editingNote?.text ?? ""}
              autoFocus
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                const nextText = event.currentTarget.value;

                setEditingNote((current) =>
                  current ? { ...current, text: nextText } : current
                );
              }}
              onBlur={commitEditingNote}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  commitEditingNote();
                }

                if (event.key === "Escape") {
                  setEditingNote(null);
                }
              }}
            />
          ) : null}

          {selectedBoxPosition ? (
            <div
              className="pointer-events-none absolute z-20 rounded-md border-2 border-ring"
              style={{
                left: selectedBoxPosition.left,
                top: selectedBoxPosition.top,
                width: Math.max(24, selectedBoxPosition.width),
                height: Math.max(24, selectedBoxPosition.height)
              }}
              aria-hidden="true"
            >
              <button
                className="pointer-events-auto absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border border-ring bg-card shadow-sm"
                type="button"
                title="Resize selected object"
                aria-label="Resize selected object"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const rect = containerRef.current?.getBoundingClientRect();

                  if (!rect) {
                    return;
                  }

                  dragRef.current = {
                    mode: "resize",
                    objectId: selectedBoxPosition.object.id,
                    start: screenToWorld(
                      {
                        x: event.clientX - rect.left,
                        y: event.clientY - rect.top
                      },
                      cameraRef.current
                    ),
                    original: selectedBoxPosition.object
                  };
                }}
                onPointerMove={(event) => {
                  event.stopPropagation();
                  const drag = dragRef.current;
                  const rect = containerRef.current?.getBoundingClientRect();

                  if (!drag || drag.mode !== "resize" || !rect) {
                    return;
                  }

                  const world = screenToWorld(
                    {
                      x: event.clientX - rect.left,
                      y: event.clientY - rect.top
                    },
                    cameraRef.current
                  );
                  const object = drag.original;

                  if (object.type === "note" || object.type === "shape") {
                    upsertObject({
                      ...object,
                      width: Math.max(64, object.width + world.x - drag.start.x),
                      height: Math.max(48, object.height + world.y - drag.start.y),
                      updatedAt: Date.now()
                    });
                  }
                }}
                onPointerUp={(event) => {
                  dragRef.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
              />
            </div>
          ) : null}

          {minimap ? (
            <aside
              className="absolute bottom-4 right-4 z-20 hidden rounded-lg border bg-card p-3 shadow-lg md:block"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                  <Navigation className="h-3.5 w-3.5" />
                  Radar
                </h2>
                <span className="text-xs text-muted-foreground">{Math.round(camera.zoom * 100)}%</span>
              </div>
              <svg
                className="cursor-pointer rounded-md bg-muted"
                width={minimap.width}
                height={minimap.height}
                viewBox={`0 0 ${minimap.width} ${minimap.height}`}
                role="button"
                aria-label="Jump around board radar"
                onClick={jumpMinimap}
              >
                {renderedObjects.map((object) => {
                  if (object.type === "stroke") {
                    const path = object.points
                      .map((point, index) => {
                        const mini = minimap.toMini(point);
                        return `${index === 0 ? "M" : "L"} ${mini.x} ${mini.y}`;
                      })
                      .join(" ");

                    return (
                      <path
                        key={object.id}
                        d={path}
                        fill="none"
                        stroke={object.color}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={Math.max(1, object.width * minimap.scale)}
                      />
                    );
                  }

                  const topLeft = minimap.toMini({ x: object.x, y: object.y });
                  const width = object.width * minimap.scale;
                  const height = object.height * minimap.scale;

                  if (object.type === "shape" && object.shape === "ellipse") {
                    return (
                      <ellipse
                        key={object.id}
                        cx={topLeft.x + width / 2}
                        cy={topLeft.y + height / 2}
                        rx={width / 2}
                        ry={height / 2}
                        fill={object.fill}
                        stroke={object.stroke}
                      />
                    );
                  }

                  return (
                    <rect
                      key={object.id}
                      x={topLeft.x}
                      y={topLeft.y}
                      width={Math.max(2, width)}
                      height={Math.max(2, height)}
                      rx={2}
                      fill={object.type === "note" ? object.color : object.fill}
                      stroke={object.type === "note" ? "#b8a45b" : object.stroke}
                    />
                  );
                })}
                {awarenessStates.map(([clientId, state]) => {
                  if (!state.viewport || !state.user) {
                    return null;
                  }

                  const topLeft = minimap.toMini({
                    x: -state.viewport.x / state.viewport.zoom,
                    y: -state.viewport.y / state.viewport.zoom
                  });

                  return (
                    <rect
                      key={clientId}
                      x={topLeft.x}
                      y={topLeft.y}
                      width={(state.viewport.width / state.viewport.zoom) * minimap.scale}
                      height={(state.viewport.height / state.viewport.zoom) * minimap.scale}
                      fill="none"
                      stroke={state.user.color}
                      strokeDasharray="3 3"
                      strokeWidth={1.5}
                    />
                  );
                })}
                <rect
                  x={minimap.viewport.x}
                  y={minimap.viewport.y}
                  width={minimap.viewport.width}
                  height={minimap.viewport.height}
                  fill="rgba(47,111,235,0.08)"
                  stroke="#2f6feb"
                  strokeWidth={1.5}
                />
              </svg>
            </aside>
          ) : null}

          {replayOpen ? (
            <aside
              className="absolute bottom-4 left-1/2 z-20 w-[min(520px,calc(100%-32px))] -translate-x-1/2 rounded-lg border bg-card p-4 shadow-lg"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Replay timeline</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {replayUpdates.length === 0
                      ? "No replay events yet"
                      : `${(replayIndex ?? 0) + 1}/${replayUpdates.length} ${activeReplayTimestamp ?? ""}`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={replayUpdates.length === 0}
                  onClick={() => {
                    setReplayPlaying((current) => !current);
                  }}
                >
                  {replayPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {replayPlaying ? "Pause" : "Play"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setReplayIndex(null);
                    setReplayOpen(false);
                    setReplayPlaying(false);
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                  Live
                </Button>
              </div>
              <input
                className="w-full accent-foreground"
                aria-label="Replay position"
                type="range"
                min={0}
                max={Math.max(0, replayUpdates.length - 1)}
                value={replayIndex ?? 0}
                disabled={replayUpdates.length === 0}
                onChange={(event) => {
                  setReplayIndex(Number(event.currentTarget.value));
                  setReplayPlaying(false);
                }}
              />
            </aside>
          ) : null}
        </section>

        <aside className="hidden min-h-0 border-l bg-background p-4 lg:block">
          <div className="flex h-full flex-col gap-5">
            <section>
              <h2 className="text-xs font-medium uppercase text-muted-foreground">Session</h2>
              <div className="mt-3 grid gap-2">
                <Button
                  variant="outline"
                  className="justify-start"
                  type="button"
                  onClick={() => {
                    void loadReplay();
                  }}
                >
                  <Play className="h-4 w-4" />
                  Replay history
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  type="button"
                  onClick={boardMeta.seededDemoAt ? resetDemoBoard : seedDemoBoard}
                >
                  <Sparkles className="h-4 w-4" />
                  {boardMeta.seededDemoAt ? "Reset demo board" : "Seed demo board"}
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  type="button"
                  onClick={exportBoardPng}
                >
                  <Download className="h-4 w-4" />
                  {exportCopied ? "PNG exported" : "Export full-board PNG"}
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  type="button"
                  disabled={!selectedId || replayIndex !== null}
                  onClick={deleteSelected}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete selected
                </Button>
              </div>
            </section>

            <section>
              <h2 className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                Collaborators
              </h2>
              <div className="mt-3 grid gap-2">
                {awarenessStates.length === 0 ? (
                  <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    Share the link to bring someone in.
                  </div>
                ) : (
                  awarenessStates.map(([clientId, state]) => (
                    <div key={clientId} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: state.user?.color ?? "#787774" }}
                      />
                      <span className="truncate">{state.user?.name ?? "Guest"}</span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section>
              <h2 className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                <Palette className="h-3.5 w-3.5" />
                Style
              </h2>
              {selectedObject ? (
                <div className="mt-3 grid gap-4">
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">Color</p>
                    <div className="flex flex-wrap gap-2">
                      {(selectedObject.type === "stroke"
                        ? STROKE_COLORS
                        : selectedObject.type === "note"
                          ? NOTE_COLORS
                          : SHAPE_COLORS
                      ).map((color) => (
                        <button
                          key={color}
                          className="h-7 w-7 rounded-md border shadow-sm ring-offset-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          style={{ background: color }}
                          type="button"
                          aria-label={`Set color ${color}`}
                          onClick={() => {
                            if (selectedObject.type === "stroke") {
                              updateSelectedObject({ color } as Partial<CanvasObject>);
                            } else if (selectedObject.type === "note") {
                              updateSelectedObject({ color } as Partial<CanvasObject>);
                            } else {
                              updateSelectedObject({ fill: color } as Partial<CanvasObject>);
                            }
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {selectedObject.type === "stroke" ? (
                    <label className="grid gap-2 text-xs text-muted-foreground">
                      Stroke width
                      <input
                        className="accent-foreground"
                        type="range"
                        min={2}
                        max={14}
                        value={selectedObject.width}
                        onChange={(event) => {
                          updateSelectedObject({
                            width: Number(event.currentTarget.value)
                          } as Partial<CanvasObject>);
                        }}
                      />
                    </label>
                  ) : null}

                  {selectedObject.type === "note" ? (
                    <Button
                      variant="outline"
                      className="justify-start"
                      type="button"
                      onClick={() => {
                        setEditingNote({ id: selectedObject.id, text: selectedObject.text });
                      }}
                    >
                      <StickyNote className="h-4 w-4" />
                      Edit note
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  Select an object to edit its style.
                </div>
              )}
            </section>
          </div>
        </aside>
      </div>
    </main>
  );
}
