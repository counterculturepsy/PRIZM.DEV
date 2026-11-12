"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Hoax1gArtwork, HOAX1G_ARTWORK_PATH } from "@/components/brand/hoax1g-brand";
import { cn } from "@/lib/utils";

const HOAX1G_MOTION_PATH = "/branding/hoax1g-advanced-motion.mp4";

export function Hoax1gMotion({
  className,
  priority = false,
  sizes = "(min-width: 1024px) 42vw, 100vw",
}: {
  className?: string;
  priority?: boolean;
  sizes?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      const shouldAutoPlay = !reducedMotion.matches;
      setAutoPlay(shouldAutoPlay);
      setVideoEnabled(true);

      if (!shouldAutoPlay) {
        videoRef.current?.pause();
        setPlaying(false);
      }
    };
    update();
    reducedMotion.addEventListener("change", update);
    return () => reducedMotion.removeEventListener("change", update);
  }, []);

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  return (
    <div className={cn("brand-motion-frame relative overflow-hidden", className)}>
      <Hoax1gArtwork className="absolute inset-0 size-full" priority={priority} sizes={sizes} />
      {videoEnabled ? (
        <video
          aria-hidden="true"
          autoPlay={autoPlay}
          className="absolute inset-0 size-full object-cover"
          loop
          muted
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          playsInline
          poster={HOAX1G_ARTWORK_PATH}
          preload="metadata"
          ref={videoRef}
        >
          <source src={HOAX1G_MOTION_PATH} type="video/mp4" />
        </video>
      ) : null}
      <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(180deg,transparent_58%,rgba(2,1,8,0.3))]" />
      {videoEnabled ? (
        <button
          aria-label={playing ? "Pause HOAX1G artwork animation" : "Play HOAX1G artwork animation"}
          aria-pressed={playing}
          className="absolute right-4 top-4 grid size-11 place-items-center rounded-full border border-white/20 bg-black/55 text-white shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-md hover:border-cyan/70 hover:text-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          onClick={togglePlayback}
          type="button"
        >
          {playing ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="ml-0.5 size-4" />}
        </button>
      ) : null}
    </div>
  );
}
