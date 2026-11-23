import Link from "next/link";
import Image from "next/image";
import { Bell, ChevronDown, CircleHelp, Search } from "lucide-react";
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
 return <div className="app-shell obsidian-shell">
 <a className="sr-only z-50 rounded-lg bg-card p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4" href="#workspace-content">Skip to content</a>
 <aside className="obsidian-sidebar">
  <Link href="/app" aria-label="HOAX1G.DEV STUDIOS overview" className="obsidian-logo"><Logo /></Link>
  <div className="obsidian-navigation"><ChromeNavigation isPlatformAdmin={isPlatformAdmin} /></div>
  <div className="obsidian-sidebar-brand"><Image src="/branding/hoax1g-studios-emblem.png" width={124} height={124} alt="HOAX1G studio emblem" /><p>Client Acquisition Platform<br />for Developers &amp; Agencies</p></div>
 </aside>
 <div className="min-w-0">
  <header className="obsidian-topbar">
   <MobileNavigation isPlatformAdmin={isPlatformAdmin}><Link href="/app"><Logo /></Link><div className="mt-5"><WorkspaceSelect memberships={memberships} activeId={activeId} id="mobile-workspace-switcher" /></div></MobileNavigation>
   <form action="/app/discover/search" className="obsidian-global-search" role="search"><Search size={21} /><label className="sr-only" htmlFor="workspace-search">Search businesses</label><input id="workspace-search" name="q" placeholder="Search businesses, opportunities, audits..." type="search" /></form>
   <div className="obsidian-topbar-actions"><Link className="obsidian-topbar-icon" href="/app/crm/tasks" aria-label="Review tasks"><Bell size={24} /></Link><Link className="obsidian-topbar-icon" href="/app/settings/profile" aria-label="Workspace settings and help"><CircleHelp size={23} /></Link><details className="obsidian-profile"><summary><span className="obsidian-avatar">{userName.split(/\s+/).map(part => part[0]).slice(0,2).join("").toUpperCase()}</span><span className="obsidian-user-name">{userName}</span><ChevronDown size={17} /></summary><div className="obsidian-profile-menu"><p>Active workspace</p><WorkspaceSelect memberships={memberships} activeId={activeId} id="desktop-workspace-switcher" stacked /><Link href="/app/settings/profile">Profile &amp; settings</Link><Link href="/api/auth/signout">Sign out</Link></div></details></div>
  </header>
  <div id="workspace-content" tabIndex={-1}>{children}</div>
 </div></div>;
}
