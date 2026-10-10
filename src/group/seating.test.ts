import assert from "node:assert/strict";
import { describe, it } from "node:test";
// The seating maths lives with the 3D scene in the web project; it is tested here because that is where the test runner is.
import { PERSON_SCALE, SEAT_GAP, seatLayout } from "../../web/src/avatar/seating.js";

describe("seatLayout", () => {
  it("never seats two people closer than a seat gap, so characters cannot overlap", () => {
    for (let n = 1; n <= 5; n++) {
      const { angles, radius } = seatLayout(n);
      assert.equal(angles.length, n);
      const points = angles.map((a) => [Math.sin(a) * radius, -Math.cos(a) * radius]);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const distance = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]);
          assert.ok(distance >= SEAT_GAP - 1e-9, `seats ${i} and ${j} of ${n} are ${distance.toFixed(2)} apart, need ${SEAT_GAP.toFixed(2)}`);
        }
      }
    }
  });

  it("keeps the group on the far side of the table, symmetric around the middle", () => {
    for (let n = 2; n <= 5; n++) {
      const { angles } = seatLayout(n);
      assert.ok(Math.max(...angles.map(Math.abs)) < (80 * Math.PI) / 180, "nobody sits at the side of the table");
      assert.ok(Math.abs(angles[0] + angles[n - 1]) < 1e-9);
    }
  });

  it("clamps the count to 1-5", () => {
    assert.equal(seatLayout(0).angles.length, 1);
    assert.equal(seatLayout(9).angles.length, 5);
  });

  it("uses a gap wide enough for a cartoon character with their elbows out", () => {
    assert.ok(SEAT_GAP > 2 * PERSON_SCALE * 1.18);
  });
});
