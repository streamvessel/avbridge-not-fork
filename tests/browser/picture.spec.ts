/**
 * What the fallback strategy paints and how its controls answer a finger,
 * for the formats only it plays. Chromium only, like lifecycle.spec.ts.
 */
import { test, expect, type Page } from "@playwright/test";
import { fixture, framesPainted, mount, painted, player, playsFrames } from "./_player.js";

test.skip(({ browserName }) => browserName !== "chromium", "fallback rendering, not strategy");
test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page.goto("/tests-harness.html");
  await page.waitForFunction(() => (window as unknown as { __avbridgeReady?: boolean }).__avbridgeReady === true);
});

const codec = (page: Page) => player(page).evaluate(
  (el) => (el as unknown as { getDiagnostics(): { videoCodec?: string } }).getDiagnostics().videoCodec);

test("plays a camera AVI: Motion JPEG, full-range yuvj422p, 8-bit PCM", async ({ page }) => {
  await mount(page, fixture("mjpeg-pcm.avi"));
  await playsFrames(page);
  expect.soft(await codec(page)).toBe("mjpeg");
});

// Taken as limited range (what WebCodecs assumes untagged), grey 16 paints black. The upper
// bound leaves room for how Chrome converts the transfer to sRGB.
test("keeps Motion JPEG's full-range levels", async ({ page }) => {
  await mount(page, fixture("mjpeg-grey16.avi"));
  await player(page).evaluate((el) => (el as unknown as HTMLMediaElement).play());
  await expect.poll(async () => (await painted(page))?.centre[0] ?? -1, { timeout: 15_000 }).toBeGreaterThan(8);
  expect.soft((await painted(page))!.centre[0]).toBeLessThan(40);
});

// Untagged, Chrome took SD video as BT.709, which paints pure green at about 216.
test("paints SD video in BT.601 colours, at its pixel aspect ratio", async ({ page }) => {
  await mount(page, fixture("xvid-green-wide.avi"));
  await playsFrames(page);
  const p = (await painted(page))!;
  expect.soft(p.centre[1]).toBeGreaterThan(240);
  expect.soft(p.width / p.height).toBeCloseTo(16 / 9, 1);
});

// A finger moves a little as it taps: that move showed the controls, and the tap's toggle hid
// them again 250 ms later. A tap mid-picture hit the unseen play button and paused the video.
test("a tap shows the controls and leaves the video playing", async ({ page }) => {
  await mount(page, fixture("bbb-mpeg4-mp3.avi"));
  await playsFrames(page);
  const box = (await player(page).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const tap = async (fx: number, fy: number) => {
    const x = box.x + box.width * fx;
    const y = box.y + box.height * fy;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 2, y: y + 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(500); // outlasts the 250 ms tap delay that hid them
  };

  await player(page).evaluate((el) => el.setAttribute("data-controls-hidden", ""));
  await tap(0.25, 0.25);
  expect.soft(await player(page).evaluate((el) => el.hasAttribute("data-controls-hidden"))).toBe(false);
  await tap(0.5, 0.5);
  expect.soft(await player(page).evaluate((el) => (el as HTMLElement).dataset.state)).toBe("playing");
  expect.soft(await framesPainted(page)).toBeGreaterThan(5);
});
