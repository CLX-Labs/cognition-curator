type Drag = { dx: number; dy: number; numberActiveTouches: number };

export function isHorizontalReviewDrag({ dx, dy, numberActiveTouches }: Drag) {
  return numberActiveTouches === 1 && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5;
}

export function reviewSwipe(
  { dx, dy, vx }: Pick<Drag, 'dx' | 'dy'> & { vx: number },
  width: number,
): 'remembered' | 'missed' | null {
  if (Math.abs(dx) <= Math.abs(dy) * 1.5) return null;
  const threshold = Math.max(72, Math.min(120, width * 0.25));
  const deliberateFlick =
    Math.abs(dx) >= 36 && Math.abs(vx) >= 0.65 && Math.sign(dx) === Math.sign(vx);
  if (Math.abs(dx) < threshold && !deliberateFlick) return null;
  return dx > 0 ? 'remembered' : 'missed';
}
