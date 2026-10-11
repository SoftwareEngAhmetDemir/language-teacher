import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { designScene, ruleDesign, styleFromDesign } from "./sceneStyle.js";

const design = { wall: "#dcefd3", floor: "#b58a5a", accent: "#2f8f4e", wood: "#d2a56b", props: ["ball"], sky: "day" };

describe("styleFromDesign", () => {
  it("works out a whole palette of #rrggbb colours from the few chosen ones", () => {
    const { palette } = styleFromDesign(design);
    for (const value of Object.values(palette)) assert.match(value, /^#[0-9a-f]{6}$/);
    assert.equal(palette.wallBottom, "#dcefd3");
    assert.equal(palette.rug, "#2f8f4e");
  });

  it("keeps the walls light and replaces colours that are not colours", () => {
    const { palette } = styleFromDesign({ ...design, wall: "#101010", accent: "red; drop table" });
    assert.ok(parseInt(palette.wallBottom.slice(1, 3), 16) > 140, "a dark wall is lightened");
    assert.equal(palette.rug, "#b6523f", "a bad accent falls back to a default");
  });

  it("allows only known props, one on the wall, two on the floor and one on the table", () => {
    const { props } = styleFromDesign({ ...design, props: ["ball", "ball", "hacker", "map", "tv", "guitar", "globe", "suitcase", "food", "laptop", "plant"] });
    assert.deepEqual(props, ["plant", "map", "ball", "guitar", "food"]);
  });

  it("always puts something on the table, and falls back to a day sky", () => {
    const style = styleFromDesign({ ...design, props: [], sky: "<script>" });
    assert.deepEqual(style.props, ["flowers"]);
    assert.equal(style.sky, "day");
  });
});

describe("designScene", () => {
  it("uses the model's design", async () => {
    const style = await designScene("my trip", async () => ({ ...design, props: ["globe", "map"], sky: "night" }));
    assert.deepEqual(style.props, ["map", "globe", "flowers"]);
    assert.equal(style.sky, "night");
  });

  it("falls back to keyword rules when the model fails or answers nothing", async () => {
    const failing = async () => {
      throw new Error("down");
    };
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.ok((await designScene("football with friends", failing)).props.includes("ball"));
    } finally {
      console.error = quiet;
    }
    assert.ok((await designScene("pizza and recipes", async () => null)).props.includes("food"));
  });

  it("gives an unknown subject a neutral room, and stops when asked to", async () => {
    assert.deepEqual(ruleDesign("zzz").props, ["bookcase", "plant", "flowers"]);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      designScene("x", async () => {
        throw new Error("aborted");
      }, controller.signal),
    );
  });
});
