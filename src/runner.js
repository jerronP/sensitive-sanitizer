import { chromium } from "playwright";
import { getSnapshot } from "./browser/snapshot.js";
import { executeActions } from "./browser/actions.js";
import { mockAIResponse } from "./ai/mockAIResponse.js";

export async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    await page.goto("https://mattkenefick.github.io/sample-shadow-dom/");
    const snapshotBefore = await getSnapshot(page);
    console.log("📸 Snapshot captured (count):", snapshotBefore.length);
    if (snapshotBefore.length) {
      console.log(JSON.stringify(snapshotBefore, null, 2));
    }

    await executeActions(page, mockAIResponse.actions);

    const snapshotAfter = await getSnapshot(page);
    console.log("📸 Snapshot after actions (count):", snapshotAfter.length);
  } catch (err) {
    console.error("💥 ERROR:", err.message);
  }

  await page.waitForTimeout(8000);
  // await browser.close();
}

if (process.env.NODE_ENV !== "test") {
  main();
}