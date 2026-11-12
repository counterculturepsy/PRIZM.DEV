import Link from "next/link";
import { BarChart3, Bot, Building2, FileText, KanbanSquare, LayoutDashboard, Lightbulb, ListChecks, MessageSquareText, ScanSearch, Search, Settings, ShieldCheck, Users } from "lucide-react";
import { CreatorBrand } from "@/components/brand/hoax1g-brand";
import { Logo } from "@/components/brand/logo";
import { selectWorkspaceAction } from "@/app/app/actions";
import type { WorkspaceSummary } from "@/server/workspaces/context";

const activeLinks = [
  { section: "Overview", href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { section: "Acquire", href: "/app/discover/search", label: "Discover", icon: Search },
  { section: "Acquire", href: "/app/discover/opportunities", label: "Opportunities", icon: Lightbulb },
  { section: "Acquire", href: "/app/companies", label: "Companies", icon: Building2 },
  { section: "Acquire", href: "/app/audits", label: "Website audits", icon: ScanSearch },
  { section: "Sell", href: "/app/leads", label: "CRM leads", icon: Users },
  { section: "Sell", href: "/app/crm/pipeline", label: "Pipeline", icon: KanbanSquare },
  { section: "Sell", href: "/app/crm/tasks", label: "Tasks", icon: ListChecks },
  { section: "Sell", href: "/app/proposals", label: "Proposals", icon: FileText },
  { section: "Assist", href: "/app/ai/strategy", label: "AI strategy", icon: Bot },
  { section: "Assist", href: "/app/ai/outreach", label: "Outreach drafts", icon: MessageSquareText },
  { section: "Assist", href: "/app/campaigns", label: "Campaign preparation", icon: MessageSquareText },
  { section: "Assist", href: "/app/reports/sales", label: "Reports", icon: BarChart3 },
  { section: "Manage", href: "/app/settings/profile", label: "Settings", icon: Settings },
] as const;

const navigationSections = ["Overview", "Acquire", "Sell", "Assist", "Manage"] as const;

function Navigation({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const links = isPlatformAdmin ? [...activeLinks, { section: "Manage", href: "/app/admin/users", label: "User approvals", icon: ShieldCheck } as const] : activeLinks;
  return (
    <nav aria-label="Application" className="grid gap-5">
      {navigationSections.map((section) => <div key={section}>
        <p className="mb-1.5 px-3 font-mono text-[9px] uppercase tracking-[0.19em] text-muted-foreground/80">{section}</p>
        <div className="grid gap-1">{links.filter((link) => link.section === section).map(({ href, label, icon: Icon }) => (
          <Link className="group flex min-h-10 items-center gap-3 rounded-xl border border-transparent px-3 text-sm text-muted-foreground transition-[background-color,border-color,color,box-shadow] hover:border-primary/25 hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={href} key={href}>
            <Icon aria-hidden="true" className="size-4 text-muted-foreground transition-colors group-hover:text-cyan" />{label}
          </Link>
        ))}</div>
      </div>)}
    </nav>
  );
}

function WorkspaceSelect({ memberships, activeId }: { memberships: readonly WorkspaceSummary[]; activeId: string | undefined }) {
  if (memberships.length === 0) return <span className="text-xs text-muted-foreground">No workspace yet</span>;
  return (
    <form action={selectWorkspaceAction}>
      <label className="sr-only" htmlFor="workspace-switcher">Active workspace</label>
      <div className="flex items-center gap-2"><select className="min-h-10 max-w-52 rounded-xl border border-border bg-surface-elevated px-3 text-sm outline-none focus:border-cyan/60 focus:ring-2 focus:ring-ring/25" defaultValue={activeId} id="workspace-switcher" name="workspaceId">
        {memberships.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select><button className="min-h-10 rounded-lg border border-border px-3 text-xs font-medium hover:border-primary" type="submit">Switch</button></div>
    </form>
  );
}

export function AppShell({ children, memberships, activeId, userName, isPlatformAdmin }: { children: React.ReactNode; memberships: readonly WorkspaceSummary[]; activeId: string | undefined; userName: string; isPlatformAdmin: boolean }) {
  return (
    <div className="min-h-screen bg-background/75 lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="hidden border-r border-border bg-card/72 p-5 shadow-[12px_0_48px_rgba(0,0,0,0.16)] backdrop-blur-xl lg:flex lg:h-screen lg:flex-col lg:overflow-hidden lg:sticky lg:top-0">
        <div className="border-b border-border/70 px-2 pb-5"><Logo /></div>
        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1"><Navigation isPlatformAdmin={isPlatformAdmin} /></div>
        <div className="mt-4 border-t border-border/70 px-2 pt-4"><CreatorBrand /></div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b border-border bg-background/82 px-4 shadow-[0_10px_32px_rgba(0,0,0,0.14)] backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="lg:hidden"><Logo className="text-sm" /></div>
          <div className="hidden lg:block"><WorkspaceSelect activeId={activeId} memberships={memberships} /></div>
          <div className="flex items-center gap-3 text-right"><div><p className="text-sm font-medium">{userName}</p><p className="text-xs text-muted-foreground">PRIZM.DEV workspace</p></div><Link className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-cyan/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/api/auth/signout">Sign out</Link></div>
        </header>
        <details className="border-b border-border bg-card/60 p-4 backdrop-blur lg:hidden">
          <summary className="cursor-pointer text-sm font-medium marker:text-primary">Navigation and workspace</summary>
          <div className="mt-4 grid gap-4"><WorkspaceSelect activeId={activeId} memberships={memberships} /><Navigation isPlatformAdmin={isPlatformAdmin} /></div>
        </details>
        <div className="relative"><div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_78%_0%,rgba(160,32,240,0.12),transparent_48%)]" />{children}</div>
      </div>
    </div>
  );
}
