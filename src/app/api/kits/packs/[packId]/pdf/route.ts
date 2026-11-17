import { KitError } from "@/server/kits/common";
import { downloadResponse, UUID_PATTERN, unavailableResponse } from "@/server/kits/http";
import { getKitPackPdf } from "@/server/kits/packs";
import { getWorkspaceContext } from "@/server/workspaces/context";

/** Signed-in review/download of a pack's PDF. Drafts are allowed so the author can review before approval. */
export async function GET(request: Request, { params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params;
  if (!UUID_PATTERN.test(packId)) return unavailableResponse();
  const { scope } = await getWorkspaceContext("read");
  try {
    const result = await getKitPackPdf(scope, packId);
    return downloadResponse({ bytes: result.bytes, filename: result.filename, contentType: "application/pdf", inline: new URL(request.url).searchParams.get("inline") === "1" });
  } catch (error) {
    if (error instanceof KitError) return unavailableResponse();
    throw error;
  }
}
