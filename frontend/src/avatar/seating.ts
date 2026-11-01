/** How big a seated person is in the scene, relative to their own units. */
export const PERSON_SCALE = 0.78;

/** Half the width of a seated cartoon character, elbows included, in their own units. */
const HALF_WIDTH = 1.18;

/** The least distance between the centres of neighbouring seats, so people never overlap. */
export const SEAT_GAP = 2 * HALF_WIDTH * PERSON_SCALE + 0.25;

export interface SeatLayout {
  /** Angle of each seat around the far side of the table in radians; 0 is straight ahead. */
  angles: number[];
  /** Distance from the table's centre to the seats. */
  radius: number;
}

/** How far apart neighbours sit around the table, in degrees, by group size. */
const STEP_DEGREES: Record<number, number> = { 2: 50, 3: 42, 4: 38, 5: 36 };

/**
 * Seats `count` people (1 to 5) on an arc around the far side of the table. The radius is worked out from
 * the angle between neighbours so that the distance between them is always SEAT_GAP.
 */
export function seatLayout(count: number): SeatLayout {
  const n = Math.min(5, Math.max(1, Math.round(count)));
  if (n === 1) return { angles: [0], radius: 2.2 };
  const step = (STEP_DEGREES[n] * Math.PI) / 180;
  const radius = SEAT_GAP / (2 * Math.sin(step / 2));
  const angles = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * step);
  return { angles, radius };
}
