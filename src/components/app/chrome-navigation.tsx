"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { BarChart3, Bot, Box, Building2, FileText, Home, Layers, Lightbulb, ListChecks, Megaphone, Menu, MessageSquareText, Search, Settings, ShieldCheck, Users, X } from "lucide-react";
const links = [
  { href: "/app", label: "Overview", icon: Home },
  { href: "/app/discover/search", label: "Discover", icon: Search },
  { href: "/app/audits", label: "Audits", icon: Layers },
  { href: "/app/crm/pipeline", label: "CRM", icon: Users },
  { href: "/app/proposals", label: "Proposals", icon: FileText },
  { href: "/app/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/app/kits", label: "Capability kits", icon: Box },
  { href: "/app/reports/sales", label: "Reports", icon: BarChart3 },
];
const moreLinks = [
  { href: "/app/discover/opportunities", label: "Opportunities", icon: Lightbulb },
  { href: "/app/companies", label: "Companies", icon: Building2 },
  { href: "/app/leads", label: "Leads & contacts", icon: Users },
  { href: "/app/crm/tasks", label: "Tasks", icon: ListChecks },
  { href: "/app/ai/strategy", label: "AI strategy", icon: Bot },
  { href: "/app/ai/outreach", label: "Outreach drafts", icon: MessageSquareText },
  { href: "/app/settings/profile", label: "Settings", icon: Settings },
];
export function ChromeNavigation({ isPlatformAdmin, onNavigate }: { isPlatformAdmin: boolean; onNavigate?: () => void }) {
 const pathname = usePathname();
 const secondary = isPlatformAdmin ? [...moreLinks, {href:"/app/admin/users",label:"User approvals",icon:ShieldCheck}] : moreLinks;
 const renderLink = ({href,label,icon:Icon}: typeof links[number])=> {
 const selected = href === "/app" ? pathname === href : pathname === href || pathname.startsWith(href + "/");
 return <Link key={href} href={href} onClick={()=>onNavigate?.()} aria-current={selected ? "page" : undefined} className="obsidian-nav-link"><Icon aria-hidden="true" />{label}</Link>;
 };
 return <nav aria-label="Application" className="obsidian-nav">{links.map(renderLink)}<details className="obsidian-more-nav" open={secondary.some(item => pathname === item.href || pathname.startsWith(item.href + "/")) || undefined}><summary>More tools</summary>{secondary.map(renderLink)}</details></nav>;
}
export function MobileNavigation({ children, isPlatformAdmin }: { children: ReactNode; isPlatformAdmin:boolean }) {
 const dialog = useRef<HTMLDialogElement>(null);
 return <><button type="button" aria-label="Open navigation" className="grid size-10 place-items-center rounded-lg border border-border lg:hidden" onClick={()=>dialog.current?.showModal()}><Menu className="size-5" /></button><dialog aria-label="Navigation and workspace" ref={dialog} className="chrome-dialog"><div className="mb-5 flex justify-end"><button type="button" aria-label="Close navigation" className="grid size-10 place-items-center rounded-lg border border-border" onClick={()=>dialog.current?.close()}><X className="size-5" /></button></div>{children}<div className="mt-6"><ChromeNavigation isPlatformAdmin={isPlatformAdmin} onNavigate={()=>dialog.current?.close()} /></div></dialog></>;
}
