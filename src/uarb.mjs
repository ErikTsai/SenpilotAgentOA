import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DOCUMENT_TYPES } from "./request.mjs";

export const SOURCE = "https://uarb.novascotia.ca/fmi/webd/UARB15";

export function parseCounts(text) {
  return Object.fromEntries(
    DOCUMENT_TYPES.map((type) => {
      const match = text.match(
        new RegExp(`(?:^|\\n)${type}\\s*-\\s*([\\d,]+)`),
      );
      if (!match) throw new Error(`Cannot read the ${type} count.`);
      return [type, Number(match[1].replaceAll(",", ""))];
    }),
  );
}

export async function fetchMatter({ matter, documentType }, folder) {
  if (!/^M\d{5}$/.test(matter) || !DOCUMENT_TYPES.includes(documentType))
    throw new Error("Invalid request.");
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "false",
  });
  try {
    const page = await browser.newPage({
      acceptDownloads: true,
      viewport: { width: 1440, height: 1200 },
    });
    page.setDefaultTimeout(60000);
    await page.goto(SOURCE);

    // FileMaker fields become editable after clicking; real key events are needed.
    const field = page
      .locator(".placeholder")
      .filter({ hasText: /^eg M01234$/ })
      .locator("..")
      .locator(":scope > .text");
    await field.click();
    await page
      .locator('[contenteditable="true"]:visible')
      .pressSequentially(matter, { delay: 100 });
    await page.locator(".fm_object_258 button").click();
    await page.waitForFunction(() =>
      /^M\d{5}$/.test(
        document
          .querySelector(".fm_object_286.fm-textarea")
          ?.innerText.trim() || "",
      ),
    );
    const actual = (
      await page.locator(".fm_object_286.fm-textarea").innerText()
    ).trim();
    if (actual !== matter)
      throw new Error(`The website returned ${actual} instead of ${matter}.`);

    const counts = parseCounts(await page.locator("body").innerText());
    // These are the website's overview field identifiers.
    const metadata = {};
    for (const [name, id] of Object.entries({
      status: 289,
      category: 287,
      type: 298,
      received: 292,
      decision: 294,
      outcome: 295,
    })) {
      metadata[name] =
        (
          await page.locator(`.fm_object_${id}.fm-textarea`).innerText()
        ).trim() || "Not listed";
    }
    metadata.title = (
      await page
        .locator(".csFM-4BAC3292-04BC-FC44-A278-B61F356EAB45.iwps_text_box")
        .innerText()
    ).trim();
    const result = {
      matter,
      documentType,
      counts,
      metadata,
      files: [],
      failures: [],
    };
    if (counts[documentType] === 0) return result;

    await page.getByText(new RegExp(`^${documentType} - [\\d,]+$`)).click();
    const buttons = page.getByRole("button", {
      name: "GO GET IT",
      exact: true,
    });
    await buttons.first().waitFor();
    const limit = Math.min(10, counts[documentType]);
    if ((await buttons.count()) < limit)
      throw new Error("The document list has not loaded completely.");
    for (let index = 0; index < limit; index++) {
      try {
        await buttons.nth(index).click();
        await page.getByText("Download Files", { exact: true }).waitFor();
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.locator(".fm-download-button").click(),
        ]);
        // Numbered prefixes prevent two files with the same name overwriting each other.
        const name = `${index + 1}-${path.basename(download.suggestedFilename().replaceAll("\\", "/")).replace(/[<>:"/\\|?*]/g, "_")}`;
        const filePath = path.join(folder, name);
        await download.saveAs(filePath);
        result.files.push({ path: filePath, name });
        console.log(`Downloaded ${name}`);
      } catch (error) {
        result.failures.push(`File ${index + 1}: ${error.message}`);
      } finally {
        const close = page.getByRole("button", { name: "Close", exact: true });
        if (await close.isVisible()) await close.click();
      }
    }
    if (!result.files.length)
      throw new Error("No files could be downloaded from the requested tab.");
    return result;
  } finally {
    await browser.close();
  }
}
