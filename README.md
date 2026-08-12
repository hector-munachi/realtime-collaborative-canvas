# iCanvas

iCanvas is a self-hosted collaborative infinite canvas for hackathon-speed visual work that can keep living after the demo. It supports real-time drawing, notes, shapes, presence cursors, browser offline persistence, and Yjs update replay.

## Documentation

- [Product documentation](./docs/PRODUCT_DOCUMENTATION.md)
- [Architecture documentation](./docs/ARCHITECTURE.md)
- [Hackathon readiness and original-scope checklist](./docs/HACKATHON_READINESS.md)

## What Is Implemented

- Infinite PixiJS canvas with pan and wheel zoom
- Draw, note, rectangle, ellipse, select, move, and delete tools
- Notion-style dashboard with recent boards
- Shareable board routes at `/boards/:boardId`
- Secret access-key share links for newly created boards
- Editable board titles stored in the collaborative Yjs document
- Inline sticky-note editing
- shadcn-style UI primitives with Tailwind CSS
- Object color and stroke-width controls
- One-click seeded demo board
- Demo reset flow for rehearsals
- Presence radar/minimap with collaborator viewport rectangles
- Visible offline/reconnect banner
- Full-board PNG export
- Matter.js physics mode: toss enabled notes/shapes, collision, and gravity wells
- Replay scrubber with play/pause
- Real-time Yjs collaboration over a self-hosted Hocuspocus server
- Offline browser persistence with IndexedDB
- Remote collaborator cursors and live user list
- Append-only replay log exposed by the sync server
- Docker Compose setup for self-hosting

## Local Development

```bash
npm install
npm run dev
```

Then open:

- Web app: http://localhost:3001
- Sync health: http://localhost:1234/health

Open the web app in two browser tabs, create or open a board, then use Share to copy the board URL. To test offline behavior, stop the sync server, keep editing in the browser, then restart it and open another tab.

New boards include a secret `?key=...` in their share URL. Keep that URL when sharing or reopening the board; it scopes the synced document and local offline cache.

## Environment

Copy `.env.example` to `.env.local` for local frontend overrides if needed.

```bash
NEXT_PUBLIC_SYNC_URL=ws://localhost:1234
NEXT_PUBLIC_SYNC_HTTP_URL=http://localhost:1234
SYNC_PORT=1234
SYNC_DATA_DIR=./data
```

## Production Shape

The sync server stores board snapshots and replay logs in `SYNC_DATA_DIR`.

For production:

- Put the web app behind HTTPS.
- Expose the sync server as WSS.
- Mount `apps/sync/data` or another durable volume.
- Add authentication in `apps/sync/src/server.ts` using Hocuspocus `onAuthenticate`.

## Hackathon Demo Script

1. Open two browser tabs.
2. Create a board from the dashboard and copy the share link.
3. Click Seed demo board so the room understands the product immediately.
4. Draw a stroke in one tab and move it in the other.
5. Use the radar to jump around the board and show collaborator viewports.
6. Stop the sync server, keep editing, restart it, and show the merge.
7. Click Replay and scrub or play the board history.
8. Export the full board as PNG.

## Next Product Steps

- Add inline rich text blocks for sticky notes
- Add production-grade account auth and board permissions
- Add export crop controls
- Add physics presets and per-board physics boundaries
