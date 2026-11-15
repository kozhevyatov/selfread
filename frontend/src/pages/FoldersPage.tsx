/** «Папки»: /folders — все подключённые папки, /folders/:id?path=… — папка медиатеки. */
import { FolderView, FoldersRoot } from "@/components/FolderView";
import { useParams, useSearchParams } from "@/lib/router";

export default function FoldersPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const libraryId = Number(id);
  if (!id || !libraryId) return <FoldersRoot />;
  return <FolderView libraryId={libraryId} path={(params.get("path") ?? "").replace(/^\/+|\/+$/g, "")} />;
}
