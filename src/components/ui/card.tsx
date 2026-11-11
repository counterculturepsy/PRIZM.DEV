import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-border bg-card/95 text-card-foreground shadow-[0_18px_48px_rgba(0,0,0,0.2)]", className)} {...props} />;
}
