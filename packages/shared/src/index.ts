export type CanvasTool = "select" | "draw" | "note" | "rect" | "ellipse" | "gravity";

export type Point = {
  x: number;
  y: number;
};

export type Camera = {
  x: number;
  y: number;
  zoom: number;
};

/**
 * Physics is deliberately part of the shared object contract. The client that
 * last grabs an object becomes its short-lived authority; everyone else only
 * renders the positions it publishes through Yjs.
 */
export type PhysicsState = {
  enabled: boolean;
  ownerId?: string;
  velocity?: Point;
  active?: boolean;
};

export type BaseCanvasObject = {
  id: string;
  createdBy: string;
  updatedAt: number;
  physics?: PhysicsState;
};

export type StrokeObject = BaseCanvasObject & {
  type: "stroke";
  points: Point[];
  color: string;
  width: number;
};

export type NoteObject = BaseCanvasObject & {
  type: "note";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
};

export type ShapeObject = BaseCanvasObject & {
  type: "shape";
  shape: "rect" | "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
};

export type GravityWellObject = BaseCanvasObject & {
  type: "gravity-well";
  x: number;
  y: number;
  radius: number;
  /** Positive attracts; negative repels. */
  strength: number;
};

export type CanvasObject = StrokeObject | NoteObject | ShapeObject | GravityWellObject;

export type AwarenessState = {
  user?: {
    id: string;
    name: string;
    color: string;
  };
  cursor?: Point;
  viewport?: Camera & {
    width: number;
    height: number;
  };
};

export type BoardMetadata = {
  title?: string;
  seededDemoAt?: number;
  updatedAt?: number;
};

export type ReplayUpdate = {
  timestamp: number;
  update: string;
};

export const BOARD_OBJECTS_KEY = "objects";
export const BOARD_META_KEY = "meta";

export function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function colorFromString(input: string): string {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = input.charCodeAt(index) + ((hash << 5) - hash);
  }

  const palette = ["#0f766e", "#2563eb", "#b45309", "#be123c", "#7c3aed", "#15803d"];
  return palette[Math.abs(hash) % palette.length];
}
