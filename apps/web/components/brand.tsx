import { WORDMARK_PATHS, WORDMARK_TITTLE, WORDMARK_VIEWBOX } from "@/lib/wordmark";

/**
 * The forgit brand: a border collie dreaming of commits, and a soft heavy
 * wordmark whose i is dotted with the accent square. The wordmark is inline
 * SVG so it takes the surrounding text color; the mascot is a PNG cut from the
 * brand sheet with a transparent background.
 */

export const TAGLINE = "Commit less. Live more.";

export function Wordmark({ height = 22, className }: { height?: number; className?: string }) {
  const [, , w, h] = WORDMARK_VIEWBOX.split(" ").map(Number);
  const width = (height * (w ?? 1)) / (h ?? 1);
  return (
    <svg
      aria-label="forgit"
      className={className ? `wordmark ${className}` : "wordmark"}
      height={height}
      role="img"
      viewBox={WORDMARK_VIEWBOX}
      width={width}
    >
      <g fill="currentColor">
        {WORDMARK_PATHS.map((path, index) => (
          <path d={path.d} key={index} transform={path.transform} />
        ))}
      </g>
      <rect
        className="wordmark-tittle"
        height={WORDMARK_TITTLE.size}
        rx={WORDMARK_TITTLE.rx}
        width={WORDMARK_TITTLE.size}
        x={WORDMARK_TITTLE.x}
        y={WORDMARK_TITTLE.y}
      />
    </svg>
  );
}

export function Mascot({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <img
      alt=""
      className={className ? `mascot ${className}` : "mascot"}
      decoding="async"
      height={size}
      src="/brand/mascot.png"
      style={{ width: "auto", height: size }}
    />
  );
}

/** Mascot plus wordmark, the lockup used in the top bar and on auth pages. */
export function Lockup({ size = 22 }: { size?: number }) {
  return (
    <span className="lockup">
      <Mascot size={size * 1.6} />
      <Wordmark height={size} />
    </span>
  );
}
