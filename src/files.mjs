import { ZipArchive } from "archiver";
import { createWriteStream } from "node:fs";

export async function makeZip(files, target) {
  const zip = new ZipArchive();
  const output = createWriteStream(target);
  const finished = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    zip.on("error", reject);
  });
  zip.pipe(output);
  for (const file of files) zip.file(file.path, { name: file.name });
  await zip.finalize();
  await finished;
}

export function formatReply({
  matter,
  documentType,
  counts,
  metadata,
  files,
  failures,
}) {
  const breakdown = Object.entries(counts)
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return `Hi,\n\n${matter} is about ${metadata.title}. It relates to ${metadata.category} within ${metadata.type}. Its status is ${metadata.status}, with outcome ${metadata.outcome}. The date received is ${metadata.received} and the decision date is ${metadata.decision} (MM/DD/YYYY).\n\nI found ${breakdown}: ${total} file entries across the five tabs in total. I downloaded ${files.length} out of ${counts[documentType]} ${documentType} and attached them as a ZIP.${failures.length ? `\n\nSome downloads failed:\n${failures.join("\n")}` : ""}\n\nSource: https://uarb.novascotia.ca/fmi/webd/UARB15`;
}
