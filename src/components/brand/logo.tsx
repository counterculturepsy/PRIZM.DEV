import { cn } from "@/lib/utils";
import { Hoax1gWordmark } from "./hoax1g-brand";

export function Logo({ className }: { className?: string }) {
  return <span className={cn("inline-flex w-[212px] max-w-full items-center", className)}><Hoax1gWordmark priority /></span>;
}
