import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const outputDir = path.resolve("docs/images");
await mkdir(outputDir, { recursive: true });

const theme = {
  bg: "#fbfbfa",
  ink: "#1f1f1f",
  muted: "#787774",
  line: "#d8d7d4",
  card: "#ffffff",
  blue: "#2f6feb",
  teal: "#0f766e",
  amber: "#b45309",
  rose: "#be123c",
  green: "#15803d",
  violet: "#7c3aed"
};

function text(x, y, content, size = 22, color = theme.ink, weight = 600) {
  return `<text x="${x}" y="${y}" font-family="Inter, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${content}</text>`;
}

function multiline(x, y, lines, size = 16, color = theme.muted, gap = 24) {
  return lines
    .map((line, index) => text(x, y + index * gap, line, size, color, 500))
    .join("");
}

function card(x, y, width, height, title, lines, accent = theme.blue) {
  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="${theme.card}" stroke="${theme.line}" />
    <rect x="${x}" y="${y}" width="6" height="${height}" rx="3" fill="${accent}" />
    ${text(x + 24, y + 36, title, 20)}
    ${multiline(x + 24, y + 66, lines, 15)}
  `;
}

function arrow(x1, y1, x2, y2, color = theme.ink) {
  const id = `arrow-${Math.round(x1)}-${Math.round(y1)}-${Math.round(x2)}-${Math.round(y2)}`;

  return `
    <defs>
      <marker id="${id}" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
        <path d="M2,2 L10,6 L2,10 Z" fill="${color}" />
      </marker>
    </defs>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2.5" marker-end="url(#${id})" />
  `;
}

async function renderPng(name, svg) {
  const file = path.join(outputDir, name);
  await sharp(Buffer.from(svg)).png().toFile(file);
  console.log(`wrote ${file}`);
}

const architecture = `
<svg width="1400" height="900" viewBox="0 0 1400 900" xmlns="http://www.w3.org/2000/svg">
  <rect width="1400" height="900" fill="${theme.bg}" />
  ${text(70, 80, "iCanvas architecture", 38)}
  ${text(72, 118, "Self-hosted collaborative canvas with offline-first CRDT state and replayable history.", 18, theme.muted, 500)}

  ${card(70, 185, 310, 150, "Next.js app shell", ["Dashboard", "Board routes", "shadcn-style UI", "Local UI state"], theme.ink)}
  ${card(70, 405, 310, 170, "PixiJS canvas", ["Infinite pan and zoom", "GPU-backed drawing", "Strokes, notes, shapes", "Visible PNG export"], theme.blue)}
  ${card(525, 185, 330, 170, "Yjs document", ["objects: Y.Map", "meta: Y.Map", "Conflict-free merges", "Replayable binary updates"], theme.teal)}
  ${card(525, 430, 330, 150, "IndexedDB persistence", ["Offline editing", "Browser-local cache", "Merge on reconnect"], theme.amber)}
  ${card(1010, 185, 320, 175, "Hocuspocus server", ["Self-hosted WebSocket sync", "Awareness cursors", "Load/store hooks", "Replay API"], theme.violet)}
  ${card(1010, 455, 320, 150, "Filesystem storage", ["snapshot.bin", "updates.jsonl", "Durable Docker volume"], theme.green)}

  ${arrow(380, 260, 525, 260)}
  ${arrow(690, 355, 690, 430)}
  ${arrow(855, 270, 1010, 270)}
  ${arrow(1170, 360, 1170, 455)}
  ${arrow(235, 405, 235, 335)}
  ${arrow(525, 500, 380, 500)}

  ${text(72, 720, "Core idea", 24)}
  ${multiline(72, 754, [
    "React owns the app chrome. Pixi owns rendering. Yjs owns collaborative board state.",
    "The browser can keep editing offline because y-indexeddb persists the same Yjs document locally.",
    "The server stores snapshots plus append-only Yjs updates, which power the replay scrubber."
  ], 18, theme.ink, 32)}
</svg>`;

const demoFlow = `
<svg width="1400" height="820" viewBox="0 0 1400 820" xmlns="http://www.w3.org/2000/svg">
  <rect width="1400" height="820" fill="${theme.bg}" />
  ${text(70, 80, "Winning demo loop", 38)}
  ${text(72, 118, "A 90-second story that proves iCanvas is useful, technical, and real.", 18, theme.muted, 500)}

  ${card(80, 190, 260, 140, "1. Create", ["Open dashboard", "Create a board", "Rename it"], theme.ink)}
  ${card(410, 190, 260, 140, "2. Seed", ["Add demo content", "Show structured canvas", "Explain the goal"], theme.amber)}
  ${card(740, 190, 260, 140, "3. Share", ["Copy board URL", "Open second tab", "See presence"], theme.teal)}
  ${card(1070, 190, 260, 140, "4. Co-create", ["Draw and move", "Edit notes inline", "Use radar"], theme.blue)}

  ${card(245, 460, 280, 150, "5. Go offline", ["Stop sync server", "Keep editing", "Banner explains safety"], theme.rose)}
  ${card(620, 460, 280, 150, "6. Reconnect", ["Restart server", "Yjs merges state", "No manual conflict step"], theme.green)}
  ${card(995, 460, 280, 150, "7. Replay/export", ["Scrub history", "Explain update log", "Export visible PNG"], theme.violet)}

  ${arrow(340, 260, 410, 260)}
  ${arrow(670, 260, 740, 260)}
  ${arrow(1000, 260, 1070, 260)}
  ${arrow(1160, 330, 445, 460)}
  ${arrow(525, 535, 620, 535)}
  ${arrow(900, 535, 995, 535)}

  ${text(86, 720, "Judge takeaway", 24)}
  ${text(86, 758, "This is not just a whiteboard. It is a self-hosted, offline-first collaboration surface with replayable team memory.", 20, theme.ink, 600)}
</svg>`;

const coverage = `
<svg width="1400" height="900" viewBox="0 0 1400 900" xmlns="http://www.w3.org/2000/svg">
  <rect width="1400" height="900" fill="${theme.bg}" />
  ${text(70, 80, "Original prompt coverage", 38)}
  ${text(72, 118, "What we set out to build, what is complete, and what remains optional.", 18, theme.muted, 500)}

  ${card(90, 180, 360, 130, "Canvas + pan/zoom", ["Status: complete", "PixiJS renderer", "Camera transform"], theme.green)}
  ${card(520, 180, 360, 130, "Yjs sync end-to-end", ["Status: complete", "Hocuspocus WebSocket", "Two-tab collaboration"], theme.green)}
  ${card(950, 180, 360, 130, "Offline editing", ["Status: complete", "y-indexeddb persistence", "Merge on reconnect"], theme.green)}

  ${card(90, 380, 360, 130, "Presence awareness", ["Status: complete", "Remote cursors", "Collaborator list"], theme.green)}
  ${card(520, 380, 360, 130, "Presence radar", ["Status: complete", "Minimap", "Viewport rectangles"], theme.green)}
  ${card(950, 380, 360, 130, "Time travel", ["Status: complete", "Update log", "Replay scrubber"], theme.green)}

  ${card(90, 580, 360, 155, "Polish/product shell", ["Status: complete", "Dashboard", "Share links", "Notion-style UI"], theme.green)}
  ${card(520, 580, 360, 155, "Self-hosting", ["Status: complete", "Docker Compose", "Filesystem persistence"], theme.green)}
  ${card(950, 580, 360, 155, "Physics mode", ["Status: complete", "Matter.js ownership", "Toss, collision, gravity wells"], theme.violet)}

  ${text(90, 810, "Readiness call", 24)}
  ${text(90, 848, "The full original scope is accomplished: collaboration, offline merge, replay, and a scoped physics wow moment.", 19, theme.ink, 600)}
</svg>`;

await renderPng("architecture.png", architecture);
await renderPng("demo-flow.png", demoFlow);
await renderPng("original-scope-coverage.png", coverage);

await writeFile(path.join(outputDir, "README.md"), `# Documentation Images

Generated by \`node docs/scripts/generate-doc-images.mjs\`.

- \`architecture.png\`
- \`demo-flow.png\`
- \`original-scope-coverage.png\`
`);
