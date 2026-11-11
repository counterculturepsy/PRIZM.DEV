import Image from "next/image";
import { cn } from "@/lib/utils";

export const HOAX1G_ARTWORK_PATH = "/branding/hoax1g-dev-geometric-artwork.png";
export const HOAX1G_WORDMARK_PATH = "/branding/hoax1g-dev-wordmark.png";

export function Hoax1gWordmark({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      alt="HOAX1G.DEV"
      className={cn("h-auto w-full object-contain object-left", className)}
      height={726}
      priority={priority}
      quality={92}
      src={HOAX1G_WORDMARK_PATH}
      width={2164}
    />
  );
}

export function Hoax1gArtwork({
  className,
  priority = false,
  sizes = "(min-width: 1024px) 42vw, 100vw",
}: {
  className?: string;
  priority?: boolean;
  sizes?: string;
}) {
  return (
    <div className={cn("brand-artwork-frame relative overflow-hidden", className)}>
      <Image
        alt="HOAX1G DEV geometric prism artwork — Code. Create. Innovate."
        className="object-contain"
        fill
        priority={priority}
        quality={92}
        sizes={sizes}
        src={HOAX1G_ARTWORK_PATH}
      />
    </div>
  );
}

export function CreatorBrand({ className, showArtwork = true }: { className?: string; showArtwork?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      {showArtwork ? (
        <span className="relative size-9 shrink-0 overflow-hidden rounded-lg border border-primary/35 bg-background shadow-[var(--shadow-neon-soft)]">
          <Image alt="" aria-hidden="true" className="object-cover" fill sizes="36px" src={HOAX1G_ARTWORK_PATH} />
        </span>
      ) : null}
      <span className="grid leading-none">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Created by</span>
        <span className="mt-1 text-xs font-semibold tracking-[0.12em] text-foreground">HOAX1G<span className="text-cyan">.DEV</span></span>
      </span>
    </span>
  );
}
