import Link from "next/link";
import { WEBSITE_AUDITING_DISABLED_MESSAGE } from "@/modules/audits/availability";

/** Company-page entry point to the audit request form; replaced by a disabled, explained control when auditing is unavailable. */
export function RequestAuditAction({ companyId, auditingEnabled }: { companyId: string; auditingEnabled: boolean }) {
  if (auditingEnabled) {
    return <Link className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground" href={`/app/audits?companyId=${companyId}`}>Request website audit</Link>;
  }
  return <div className="mt-5">
    <button aria-describedby="company-audit-unavailable" className="inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center rounded-lg bg-muted px-4 text-sm font-semibold text-muted-foreground" disabled type="button">Request website audit</button>
    <p className="mt-2 text-xs leading-5 text-muted-foreground" id="company-audit-unavailable" role="status">{WEBSITE_AUDITING_DISABLED_MESSAGE}</p>
  </div>;
}
