import Link from "next/link";
import { Briefcase } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ChromeNavigation, MobileNavigation } from "./chrome-navigation";
import { selectWorkspaceAction } from "@/app/app/actions";
import type { WorkspaceSummary } from "@/server/workspaces/context";
function WorkspaceSelect({ memberships, activeId, id, stacked = false }: { memberships: readonly WorkspaceSummary[]; activeId: string | undefined; id: string; stacked?: boolean }) {
  if (memberships.length === 0) return <span className="text-xs text-muted-foreground">No workspace yet</span>;
  return (
    <form action={selectWorkspaceAction}>
      <label className="sr-only" htmlFor={id}>Active workspace</label>
      <div className={stacked ? "grid gap-2" : "flex items-center gap-2"}><select className="min-h-10 flex-1 w-full min-w-0 rounded-xl border border-border bg-surface-elevated px-3 text-sm outline-none focus:border-cyan/60 focus:ring-2 focus:ring-ring/25" defaultValue={activeId} id={id} name="workspaceId">
        {memberships.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select><button className={`min-h-10 rounded-lg border border-border px-3 text-xs font-medium hover:border-primary${stacked ? " w-full" : ""}`} type="submit">Switch</button></div>
    </form>
  );
}


export function AppShell({ children, memberships, activeId, userName, isPlatformAdmin }: { children: React.ReactNode; memberships: readonly WorkspaceSummary[]; activeId: string | undefined; userName: string; isPlatformAdmin: boolean }) {
 return <div className="app-shell min-h-screen lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
 <a className="sr-only z-50 rounded-lg bg-card p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4" href="#workspace-content">Skip to content</a>
 <aside className="sticky top-0 hidden h-screen flex-col border-r border-border bg-[#0d0e14] px-5 py-6 lg:flex">
  <Link href="/app" aria-label="HOAX1G.DEV STUDIOS overview" className="mx-auto mb-6"><Logo /></Link>
  <div className="mb-5 rounded-xl border border-border bg-surface-elevated/60 p-3"><p className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground"><Briefcase className="size-3" />Workspace</p><WorkspaceSelect memberships={memberships} activeId={activeId} id="desktop-workspace-switcher" stacked /></div>
  <div className="min-h-0 flex-1 overflow-y-auto"><ChromeNavigation isPlatformAdmin={isPlatformAdmin} /></div>
  <div className="mt-5 border-t border-border pt-4"><p className="text-xs font-medium">HOAX1G.DEV STUDIOS</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Client acquisition for developers & agencies.</p></div>
 </aside>
 <div className="min-w-0">
  <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6 lg:px-8">
   <div className="flex min-w-0 items-center gap-3"><MobileNavigation isPlatformAdmin={isPlatformAdmin}><Link href="/app"><Logo /></Link><div className="mt-5"><WorkspaceSelect memberships={memberships} activeId={activeId} id="mobile-workspace-switcher" /></div></MobileNavigation><span className="hidden text-[11px] uppercase tracking-[.16em] text-muted-foreground sm:block">Client acquisition workspace</span><span className="text-xs font-semibold sm:hidden">HOAX1G.DEV</span></div>
   <div className="flex min-w-0 items-center gap-3"><span className="hidden size-8 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-xs text-purple-200 sm:flex" aria-hidden="true">{userName.slice(0,1).toUpperCase()}</span><p className="max-w-36 truncate text-xs font-medium">{userName}</p><Link className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground" href="/api/auth/signout">Sign out</Link></div>
  </header>
  <div id="workspace-content" tabIndex={-1}>{children}</div>
 </div></div>;
}
