import { gsap } from "gsap";

/**
 * Motion rules for this product.
 *
 * 1. Motion reports state change. Nothing moves for decoration.
 * 2. Fast. Nothing that gates a read runs longer than 240ms.
 * 3. Never blocks input. Animations run on transform and opacity only, and no
 *    element is made unclickable while one is playing.
 * 4. Financial values are never counted up. A number that tweens from 0 to
 *    1,204.83 displays 900-odd wrong values on the way, and a person reading
 *    mid-tween reads a lie. Amounts snap to the exact figure and the *frame*
 *    around them acknowledges the change instead.
 */

export const DURATION = {
  micro: 0.12,
  fast: 0.18,
  base: 0.24,
  slow: 0.36,
} as const;

export const EASE = {
  out: "power2.out",
  inOut: "power2.inOut",
  snap: "power3.out",
} as const;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Runs a timeline, or applies its end state immediately when the viewer has
 * asked for reduced motion. Callers always get the same final layout.
 */
export function timeline(build: (tl: gsap.core.Timeline) => void): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true });
  build(tl);
  if (prefersReducedMotion()) {
    tl.progress(1, false);
  } else {
    tl.play();
  }
  return tl;
}

/** Entry for a group of rows. Deliberately short and barely staggered. */
export function revealRows(targets: gsap.TweenTarget): gsap.core.Timeline | null {
  if (prefersReducedMotion()) {
    gsap.set(targets, { opacity: 1, y: 0 });
    return null;
  }
  return gsap.timeline().fromTo(
    targets,
    { opacity: 0, y: 6 },
    {
      opacity: 1,
      y: 0,
      duration: DURATION.base,
      ease: EASE.out,
      stagger: 0.02,
    },
  ) as gsap.core.Timeline;
}

/**
 * Acknowledges that a value changed without animating the value itself.
 * The number is already correct when this runs.
 */
export function flashChange(target: Element | null): void {
  if (!target || prefersReducedMotion()) return;
  gsap.fromTo(
    target,
    { backgroundColor: "rgba(120, 190, 255, 0.16)" },
    {
      backgroundColor: "rgba(120, 190, 255, 0)",
      duration: DURATION.slow,
      ease: EASE.out,
      clearProps: "backgroundColor",
    },
  );
}

/**
 * Counts an integer. Only safe for counts of things, never for money.
 */
export function countInteger(
  target: HTMLElement | null,
  from: number,
  to: number,
  format: (value: number) => string = String,
): void {
  if (!target) return;
  if (prefersReducedMotion() || from === to) {
    target.textContent = format(to);
    return;
  }
  const state = { value: from };
  gsap.to(state, {
    value: to,
    duration: DURATION.base,
    ease: EASE.out,
    onUpdate: () => {
      target.textContent = format(Math.round(state.value));
    },
    onComplete: () => {
      target.textContent = format(to);
    },
  });
}

/** Drives a 0..1 progress bar without re-laying out the row. */
export function setProgress(target: Element | null, ratio: number): void {
  if (!target) return;
  const clamped = Math.max(0, Math.min(1, ratio));
  if (prefersReducedMotion()) {
    gsap.set(target, { scaleX: clamped });
    return;
  }
  gsap.to(target, {
    scaleX: clamped,
    duration: DURATION.slow,
    ease: EASE.out,
    overwrite: "auto",
  });
}
