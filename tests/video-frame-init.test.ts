import { describe, it, expect } from "vitest";
import { isPlanarYuv, videoFrameInit } from "../src/strategies/fallback/video-frame-init.js";

const layout = [{ offset: 0, stride: 640 }, { offset: 307200, stride: 320 }, { offset: 384000, stride: 320 }];
const frame = (over: object = {}) => ({ format: 0, width: 640, height: 480, layout, ...over });

describe("videoFrameInit", () => {
  it("tags SD video BT.601 and HD BT.709, limited range", () => {
    expect(videoFrameInit(frame(), 0).colorSpace).toEqual(
      { matrix: "smpte170m", primaries: "smpte170m", transfer: "smpte170m", fullRange: false });
    expect(videoFrameInit(frame({ width: 1280, height: 720 }), 0).colorSpace).toEqual(
      { matrix: "bt709", primaries: "bt709", transfer: "bt709", fullRange: false });
  });

  it("builds Motion JPEG's yuvj formats as full-range BT.601, at any size", () => {
    const init = videoFrameInit(frame({ format: 13, width: 1920, height: 1080 }), 5);
    expect(init.format).toBe("I422");
    expect(init.colorSpace).toEqual({ matrix: "smpte170m", primaries: "smpte170m", transfer: "smpte170m", fullRange: true });
    expect(init.timestamp).toBe(5);
  });

  it("maps each planar format", () => {
    expect([0, 4, 5, 12, 13, 14].map((format) => videoFrameInit(frame({ format }), 0).format))
      .toEqual(["I420", "I422", "I444", "I420", "I422", "I444"]);
  });

  it("applies the pixel aspect ratio to the display size", () => {
    const init = videoFrameInit(frame({ width: 320, height: 240, sample_aspect_ratio: [4, 3] }), 0);
    expect([init.displayWidth, init.displayHeight]).toEqual([427, 240]);
    expect(init.codedWidth).toBe(320);
  });

  it("ignores a square, missing or broken pixel aspect ratio", () => {
    for (const sar of [[1, 1], [0, 1], [1, 0], [1, 1000], [1000, 1]]) {
      expect(videoFrameInit(frame({ sample_aspect_ratio: sar }), 0).displayWidth).toBeUndefined();
    }
  });
});

describe("isPlanarYuv", () => {
  it("accepts planar YUV with planes and a size, and nothing else", () => {
    expect(isPlanarYuv(frame())).toBe(true);
    expect(isPlanarYuv(frame({ format: 23 }))).toBe(false); // nv12: the bridge's
    expect(isPlanarYuv(frame({ format: 7 }))).toBe(false); // yuv411p (DV): nobody's
    expect(isPlanarYuv(frame({ layout: undefined }))).toBe(false);
  });
});
