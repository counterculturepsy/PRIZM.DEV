import Link from "next/link";
import { Card } from "@/components/ui/card";
import type { WorkspaceScope } from "@/modules/workspaces/scope";
import { listTargetAttachments, type AttachmentState, type AttachmentTarget } from "@/server/kits/packs";

const STATE_LABEL: Record<AttachmentState, string> = { approved: "Approved", changed_since_approval: "Changed since approval", draft: "Not approved" };
const STATE_STYLE: Record<AttachmentState, string> = { approved: "bg-success/15 text-success", changed_since_approval: "bg-warning/15 text-warning", draft: "bg-muted text-muted-foreground" };

/**
 * Capability packs attached to a lead, proposal or campaign, with each pack's current approval state and when its newest
 * share link expires. Attachments are references: this panel never sends or shares anything.
 */
export async function AttachedPacks({ scope, target, blocksSending = false }: { scope: WorkspaceScope; target: AttachmentTarget; blocksSending?: boolean }) {
  const items = await listTargetAttachments(scope, target);
  const stale = items.filter((item) => item.state !== "approved");
  return <Card className="p-6">
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Capability packs</h2><Link className="text-xs text-primary hover:underline" href="/app/kits">Manage kits</Link></div>
    {items.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No capability pack is attached. Attach an approved pack from its page under Capability kits.</p> : <div className="mt-4 grid gap-3">
      {items.map((item) => <article className="rounded-xl border border-border p-3 text-sm" key={item.attachmentId}>
        <div className="flex flex-wrap items-center justify-between gap-2"><Link className="font-medium text-primary hover:underline" href={`/app/kits/packs/${item.packId}`}>{item.title}</Link><span className={`rounded-full px-2.5 py-0.5 text-xs ${STATE_STYLE[item.state]}`}>{STATE_LABEL[item.state]}</span></div>
        <p className="mt-1 text-xs text-muted-foreground">For {item.recipientName}{item.approvedAt ? ` · approved ${item.approvedAt.toLocaleString("en-ZA")}` : ""}</p>
        <p className="mt-1 text-xs text-muted-foreground">{item.activeLinks > 0 && item.linkExpiresAt ? `${item.activeLinks} active share link${item.activeLinks === 1 ? "" : "s"}, newest expires ${item.linkExpiresAt.toLocaleString("en-ZA")}` : "No active share link"}</p>
      </article>)}
    </div>}
    {stale.length > 0 ? <p className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs leading-5" role="status">{blocksSending ? "Sending is blocked until every attached pack is approved again exactly as it now stands." : "A pack that changed after approval must be reviewed and approved again before it can be shared or used for sending."}</p> : null}
  </Card>;
}
