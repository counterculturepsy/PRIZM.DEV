"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { BarChart3, Bot, Briefcase, Building2, FileText, KanbanSquare, LayoutDashboard, Lightbulb, ListChecks, Menu, MessageSquareText, ScanSearch, Search, Settings, ShieldCheck, Users, X } from "lucide-react";
const links = [
  { href: "/app", label: "Overview", icon: LayoutDashboard },
  { href: "/app/discover/search", label: "Discover", icon: Search },
  { href: "/app/discover/opportunities", label: "Opportunities", icon: Lightbulb },
  { href: "/app/companies", label: "Companies", icon: Building2 },
  { href: "/app/audits", label: "Audits", icon: ScanSearch },
  { href: "/app/crm/pipeline", label: "CRM pipeline", icon: KanbanSquare },
  { href: "/app/leads", label: "Leads & contacts", icon: Users },
  { href: "/app/crm/tasks", label: "Tasks", icon: ListChecks },
  { href: "/app/proposals", label: "Proposals", icon: FileText },
  { href: "/app/kits", label: "Capability kits", icon: Briefcase },
  { href: "/app/campaigns", label: "Campaigns", icon: MessageSquareText },
  { href: "/app/ai/strategy", label: "AI strategy", icon: Bot },
  { href: "/app/ai/outreach", label: "Outreach drafts", icon: MessageSquareText },
  { href: "/app/reports/sales", label: "Reports", icon: BarChart3 },
  { href: "/app/settings/profile", label: "Settings", icon: Settings },
];
export function ChromeNavigation({ isPlatformAdmin, onNavigate }: { isPlatformAdmin: boolean; onNavigate?: () => void }) {
 const pathname = usePathname();
 const items = isPlatformAdmin ? [...links, {href:"/app/admin/users",label:"User approvals",icon:ShieldCheck}] : links;
 return <nav aria-label="Application" className="grid gap-1">{items.map(({href,label,icon:Icon})=> {
 const selected = href === "/app" ? pathname === href : pathname === href || pathname.startsWith(href + "/");
 return <Link key={href} href={href} onClick={()=>onNavigate?.()} aria-current={selected ? "page" : undefined} className={"flex min-h-10 items-center gap-3 rounded-lg border px-3 text-[13px] transition-colors " + (selected ? "border-primary/55 bg-primary/15 text-foreground" : "border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground")}><Icon aria-hidden="true" className="size-[17px] shrink-0" />{label}</Link>;
 })}</nav>;
}
export function MobileNavigation({ children, isPlatformAdmin }: { children: ReactNode; isPlatformAdmin:boolean }) {
 const dialog = useRef<HTMLDialogElement>(null);
 return <><button type="button" aria-label="Open navigation" className="grid size-10 place-items-center rounded-lg border border-border lg:hidden" onClick={()=>dialog.current?.showModal()}><Menu className="size-5" /></button><dialog aria-label="Navigation and workspace" ref={dialog} className="chrome-dialog"><div className="mb-5 flex justify-end"><button type="button" aria-label="Close navigation" className="grid size-10 place-items-center rounded-lg border border-border" onClick={()=>dialog.current?.close()}><X className="size-5" /></button></div>{children}<div className="mt-6"><ChromeNavigation isPlatformAdmin={isPlatformAdmin} onNavigate={()=>dialog.current?.close()} /></div></dialog></>;
}
