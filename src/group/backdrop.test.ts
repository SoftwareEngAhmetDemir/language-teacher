import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { designBackdrop, type ImageModel } from "./backdrop.js";

const picture = { mime: "image/jpeg", data: Buffer.from([1, 2, 3]) };

describe("designBackdrop", () => {
  it("paints a topic once and reuses the picture", async () => {
    let calls = 0;
    const model: ImageModel = async () => (calls++, picture);
    assert.equal(await designBackdrop("Garden", model), picture);
    assert.equal(await designBackdrop("garden", model), picture, "the topic is matched without regard to case");
    assert.equal(calls, 1);
  });

  it("tries again when no picture comes back, and does not remember a failure", async () => {
    let calls = 0;
    const flaky: ImageModel = async () => (++calls === 1 ? null : picture);
    assert.equal(await designBackdrop("school", flaky), picture);
    const broken: ImageModel = async () => null;
    assert.equal(await designBackdrop("mountains", broken), null);
    assert.equal(await designBackdrop("mountains", async () => picture), picture);
  });
});
