import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <span aria-hidden="true" className="relative grid size-8 place-items-center overflow-hidden rounded-lg border border-primary/40 bg-primary/10 shadow-[var(--shadow-neon-soft)]">
        <span className="absolute inset-0 bg-[linear-gradient(145deg,rgba(160,32,240,0.2),rgba(0,217,255,0.08))]" />
        <span className="prism-mark" />
      </span>
      <span>PRIZM<span className="text-cyan">.DEV</span></span>
    </span>
  );
}
