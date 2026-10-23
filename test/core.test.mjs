import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseRequest, DOCUMENT_TYPES } from "../src/request.mjs";
import { parseCounts } from "../src/uarb.mjs";
import { makeZip, formatReply } from "../src/files.mjs";

test("understands the example email and all five supported types", async () => {
  for (const documentType of DOCUMENT_TYPES) {
    assert.deepEqual(
      await parseRequest(
        `Hi Agent, can you give me ${documentType} files from m12205? Thanks!`,
      ),
      { matter: "M12205", documentType },
    );
  }
});

test("asks for clarification when a request is missing or ambiguous", async () => {
  for (const text of [
    "Exhibits",
    "M12205",
    "M12205 M12383 Exhibits",
    "M12205 Exhibits Transcripts",
  ]) {
    await assert.rejects(parseRequest(text));
  }
  await assert.rejects(
    parseRequest("M12205 audio", async () => ({
      matter: "M99999",
      documentType: "Recordings",
    })),
  );
});

test("can interpret alternative wording through the AI parser", async () => {
  assert.deepEqual(
    await parseRequest("M12205 hearing audio", async () => ({
      matter: "M12205",
      documentType: "Recordings",
    })),
    { matter: "M12205", documentType: "Recordings" },
  );
});

test("reply includes full tab counts, attached count, and matter metadata", () => {
  const counts = parseCounts(
    "Exhibits - 13\nKey Documents - 6\nOther Documents - 43\nTranscripts - 0\nRecordings - 0",
  );
  const text = formatReply({
    matter: "M12205",
    documentType: "Other Documents",
    counts,
    metadata: {
      title: "Water project",
      category: "Capital Expenditure Approvals",
      type: "Water",
      status: "Closed",
      outcome: "Approved",
      received: "04/07/2025",
      decision: "10/23/2025",
    },
    files: Array(10),
    failures: [],
  });
  assert.match(text, /62 file entries/);
  assert.match(text, /10 out of 43 Other Documents/);
  assert.match(text, /Water project/);
  assert.match(text, /04\/07\/2025/);
});

test("creates a ZIP from downloaded files, including an empty tab", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "senpilot-"));
  try {
    const filePath = path.join(folder, "document.txt");
    await writeFile(filePath, "A public document");
    const zipPath = path.join(folder, "documents.zip");
    await makeZip([{ path: filePath, name: "document.txt" }], zipPath);
    assert.equal((await readFile(zipPath)).readUInt32LE(0), 0x04034b50);
    const emptyPath = path.join(folder, "empty.zip");
    await makeZip([], emptyPath);
    assert.equal((await readFile(emptyPath)).readUInt32LE(0), 0x06054b50);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
