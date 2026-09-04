/**
 * Topographic background: a 2D canvas of contour lines that subtly suggest a
 * goat profile. Solid blue strokes at low opacity, slow drift, and fully
 * static when the user prefers reduced motion.
 */

const LINES = 30;
const SEGMENTS = 140;
/** Horizontal drift in radians per second — deliberately slow. */
const DRIFT = 0.05;

function darkMode(): boolean {
  return document.documentElement.getAttribute("data-theme") !== "light";
}

/**
 * Goat-profile modulation: a horn arc near the top, a muzzle wedge near the
 * middle, sampled as a horizontal offset for a normalized height `y` in [0,1].
 */
function goatOffset(y: number): number {
  const horn = Math.exp(-Math.pow((y - 0.24) / 0.075, 2)) * 0.075;
  const head = Math.exp(-Math.pow((y - 0.46) / 0.11, 2)) * -0.055;
  const beard = Math.exp(-Math.pow((y - 0.62) / 0.06, 2)) * -0.028;
  return horn + head + beard;
}

function strokeFor(dark: boolean, depth: number): string {
  const alpha = 0.028 + depth * 0.0035;
  return dark
    ? `rgba(57,167,255,${alpha.toFixed(3)})`
    : `rgba(11,98,196,${(alpha * 0.9).toFixed(3)})`;
}

export function startTopo(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => undefined;

  let raf = 0;
  let running = true;
  let width = 0;
  let height = 0;

  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.floor(rect.width * dpr));
    height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.width = width;
    canvas.height = height;
  };
  resize();
  window.addEventListener("resize", resize);

  const draw = (phase: number) => {
    ctx.clearRect(0, 0, width, height);
    const dark = darkMode();
    ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1);
    for (let l = 0; l < LINES; l++) {
      const yBase = (l + 0.5) / LINES;
      ctx.beginPath();
      ctx.strokeStyle = strokeFor(dark, l / LINES);
      for (let s = 0; s <= SEGMENTS; s++) {
        const x01 = s / SEGMENTS;
        const wobble =
          Math.sin(x01 * 9.2 + phase + l * 0.55) * 0.012 +
          Math.sin(x01 * 23.7 - phase * 0.7 + l * 1.3) * 0.006 +
          goatOffset(yBase) * Math.sin(x01 * Math.PI);
        const x = (x01 + wobble) * width;
        const y = yBase * height + Math.sin(x01 * 5.1 + l * 0.9 + phase * 0.4) * height * 0.004;
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  };

  if (reduced) {
    draw(0);
    const onTheme = () => draw(0);
    document.documentElement.addEventListener("ohmg:theme", onTheme);
    return () => {
      window.removeEventListener("resize", resize);
      document.documentElement.removeEventListener("ohmg:theme", onTheme);
    };
  }

  let start: number | null = null;
  let last = 0;
  const frame = (now: number) => {
    if (!running) return;
    if (start === null) start = now;
    /* Throttle to ~24fps: the drift is slow, no need for full rate. */
    if (now - last > 42) {
      last = now;
      draw(((now - start) / 1000) * DRIFT);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };
}
