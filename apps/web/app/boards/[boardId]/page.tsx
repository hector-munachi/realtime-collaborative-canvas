import { CanvasWorkspace } from "../../../components/canvas/canvas-workspace";

export default async function BoardPage({
  params,
  searchParams
}: {
  params: Promise<{ boardId: string }>;
  searchParams: Promise<{ key?: string }>;
}) {
  const { boardId } = await params;
  const { key } = await searchParams;

  return <CanvasWorkspace boardId={decodeURIComponent(boardId)} initialAccessKey={key} />;
}
