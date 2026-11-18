import { KitError } from "@/server/kits/common";
import { downloadResponse, UUID_PATTERN, unavailableResponse } from "@/server/kits/http";
import { getKitAssetFile } from "@/server/kits/library";
import { getWorkspaceContext } from "@/server/workspaces/context";

/** Signed-in, workspace-scoped download or preview of one document version. There is no public URL for these files. */
export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!UUID_PATTERN.test(assetId)) return unavailableResponse();
  const url = new URL(request.url);
  const versionParam = url.searchParams.get("version");
  const version = versionParam === null ? undefined : Number(versionParam);
  if (version !== undefined && (!Number.isInteger(version) || version < 1 || version > 1000)) return unavailableResponse();
  const { scope } = await getWorkspaceContext("read");
  try {
    const file = await getKitAssetFile(scope, assetId, { version });
    return downloadResponse({ bytes: file.data, filename: file.filename, contentType: file.contentType, inline: url.searchParams.get("inline") === "1" });
  } catch (error) {
    if (error instanceof KitError) return unavailableResponse();
    throw error;
  }
}
