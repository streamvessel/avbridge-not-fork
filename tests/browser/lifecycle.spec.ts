/**
 * Players that come and go on one page, played by URL (HTTP Range reads, as a
 * real app streams them) rather than as a Blob. Chromium only: what these
 * guard is avbridge's own libav and element lifecycle, not a browser's
 * strategy choice.
 *
 * Every libav.js call runs in turn on its instance's worker, so a read that
 * never answers (a phone's network) held up every later call on it. With one
 * instance shared by the page, that stopped every later video, the stalled
 * one included, until a reload. Each probe and decoder now has an instance of
 * its own, released when it is done.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { resolve } from "node:path";

test.skip(({ browserName }) => browserName !== "chromium", "lifecycle, not strategy");
test.setTimeout(90_000);

const fixture = (name: string) => `/@fs${resolve("tests/fixtures", name)}`;
const LONG = "bbb-mpeg4-mp3.avi"; // 30 s, read in many Range requests as it plays
const CAMERA = "mjpeg-pcm.avi";

test.beforeEach(async ({ page }) => {
  await page.goto("/tests-harness.html");
  await page.waitForFunction(() => (window as unknown as { __avbridgeReady?: boolean }).__avbridgeReady === true);
});

type Player = HTMLElement & {
  src: string;
  muted: boolean;
  currentTime: number;
  play(): Promise<void>;
  destroy(): Promise<void>;
  getDiagnostics(): { runtime?: { framesPainted?: number } } | null;
};

/** Mounts a player on `url` and waits for ready. */
async function mount(page: Page, url: string): Promise<void> {
  await page.evaluate(async (src) => {
    const mount = document.getElementById("player-mount")!;
    const player = document.createElement("avbridge-player") as Player;
    player.muted = true;
    mount.appendChild(player);
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error("ready timeout")), 20_000);
      player.addEventListener("ready", () => { clearTimeout(timer); ok(); }, { once: true });
      player.addEventListener("error", (e) => {
        clearTimeout(timer);
        fail((e as unknown as CustomEvent).detail?.error ?? new Error("error event"));
      }, { once: true });
      player.src = src;
    });
  }, url);
}

const player = (page: Page) => page.locator("#player-mount avbridge-player");

async function framesPainted(page: Page): Promise<number> {
  return player(page).evaluate((el) => (el as Player).getDiagnostics()?.runtime?.framesPainted ?? 0);
}

/** Plays and waits until the player has painted frames. */
async function playsFrames(page: Page): Promise<void> {
  await player(page).evaluate((el) => (el as Player).play());
  await expect.poll(() => framesPainted(page), { timeout: 15_000 }).toBeGreaterThan(5);
}

/** Destroys and removes the player; resolves the ms destroy() took, or -1 past `limitMs`. */
async function close(page: Page, limitMs: number): Promise<number> {
  return page.evaluate(async (limit) => {
    const el = document.querySelector("#player-mount avbridge-player") as Player;
    const t0 = performance.now();
    const done = await Promise.race([
      el.destroy().then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), limit)),
    ]);
    el.remove();
    return done ? performance.now() - t0 : -1;
  }, limitMs);
}

test("a stalled read stops neither the next video nor the stalled one later", async ({ page }) => {
  await mount(page, fixture(LONG));
  await playsFrames(page);

  // From here on no read of the long file is ever answered; a seek far ahead needs new ones.
  const stalled: Route[] = [];
  await page.route(`**/${LONG}`, (route) => { stalled.push(route); });
  await player(page).evaluate((el) => { (el as Player).currentTime = 25; });
  await expect.poll(() => stalled.length, { timeout: 10_000 }).toBeGreaterThan(0);

  expect(await close(page, 5_000), "destroy() should not wait on a stalled read").toBeGreaterThanOrEqual(0);

  await mount(page, fixture(CAMERA));
  await playsFrames(page);
  await close(page, 5_000);

  await page.unroute(`**/${LONG}`);
  await Promise.all(stalled.map((r) => r.abort().catch(() => undefined)));
  await mount(page, fixture(LONG));
  await playsFrames(page);
});

test("plays after many players opened and closed, some before they were ready", async ({ page }) => {
  const files = [LONG, CAMERA, "bbb-h264-mp3.avi", CAMERA];
  for (let round = 0; round < 8; round++) {
    const file = files[round % files.length];
    if (round % 3 === 2) {
      // Closed while still opening.
      void page.evaluate((src) => {
        const el = document.createElement("avbridge-player") as Player;
        el.muted = true;
        document.getElementById("player-mount")!.appendChild(el);
        el.src = src;
      }, fixture(file));
      await page.waitForTimeout(150);
    } else {
      await mount(page, fixture(file));
      await playsFrames(page);
    }
    expect.soft(await close(page, 5_000), `round ${round}: destroy() settled`).toBeGreaterThanOrEqual(0);
  }
  await mount(page, fixture(LONG));
  await playsFrames(page);
});
