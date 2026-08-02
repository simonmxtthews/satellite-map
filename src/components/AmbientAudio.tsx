import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

// "Meditation Impromptu 01" by Kevin MacLeod (incompetech.com), licensed
// under Creative Commons BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
// See README for the required attribution.
const AMBIENT_TRACK_SRC = `${import.meta.env.BASE_URL}audio/ambient.mp3`;

// Browsers block audio autoplay until the user has interacted with the
// page at least once. We attempt to start immediately on mount (works in
// some browsers/contexts), and otherwise fall back to starting on the
// user's very first click/keypress anywhere on the page — so it still
// feels automatic without ever silently failing to play at all.
export function AmbientAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const audio = new Audio(AMBIENT_TRACK_SRC);
    audio.loop = true;
    audio.volume = 0.1;
    audioRef.current = audio;

    const tryPlay = () => {
      audio.play().catch(() => {
        /* blocked until a user gesture arrives; the listeners below retry */
      });
    };
    tryPlay();

    window.addEventListener("pointerdown", tryPlay);
    window.addEventListener("keydown", tryPlay);

    return () => {
      window.removeEventListener("pointerdown", tryPlay);
      window.removeEventListener("keydown", tryPlay);
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) {
      audioRef.current.muted = next;
      if (!next) audioRef.current.play().catch(() => {});
    }
  };

  return (
    <button
      className="audio-toggle icon-btn"
      onClick={toggleMuted}
      aria-label={muted ? "Unmute ambient music" : "Mute ambient music"}
      title={muted ? "Unmute ambient music" : "Mute ambient music"}
    >
      {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
    </button>
  );
}
