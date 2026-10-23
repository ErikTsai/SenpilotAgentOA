import "dotenv/config";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseRequest, createAIParser } from "../src/request.mjs";
import { fetchMatter } from "../src/uarb.mjs";
import { makeZip, formatReply } from "../src/files.mjs";

// Test collection without connecting to an email account or sending anything.
try {
  const text = process.argv.slice(2).join(" ");
  if (!text)
    throw new Error('Usage: npm run preview -- "Other Documents from M12205"');
  const request = await parseRequest(text, await createAIParser());
  await mkdir("data", { recursive: true });
  const folder = await mkdtemp(path.resolve("data/preview-"));
  const result = await fetchMatter(request, folder);
  await makeZip(result.files, path.join(folder, `${request.matter}.zip`));
  const reply = formatReply(result);
  await writeFile(path.join(folder, "reply.txt"), reply);
  console.log(`${reply}\n\nSaved to ${folder}. No email sent.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
