import "dotenv/config";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { parseRequest, createAIParser } from "./request.mjs";
import { fetchMatter } from "./uarb.mjs";
import { makeZip, formatReply } from "./files.mjs";

// Start here: npm start. This one process checks the inbox every 30 seconds.
for (const key of [
  "IMAP_HOST",
  "IMAP_USER",
  "IMAP_PASSWORD",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "MAIL_FROM",
]) {
  if (!process.env[key]) throw new Error(`Missing ${key} in .env`);
}
const ai = await createAIParser();
const smtp = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: process.env.SMTP_SECURE !== "false",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
});

async function checkInbox() {
  const inbox = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD },
    logger: false,
  });
  inbox.on("error", (error) => console.error("Inbox:", error.message));
  try {
    await inbox.connect();
    await inbox.mailboxOpen("INBOX");
    const unread = await inbox.search({ seen: false }, { uid: true });
    for (const uid of unread || []) {
      const message = await inbox.fetchOne(
        String(uid),
        { source: true },
        { uid: true },
      );
      if (!message) continue;
      const email = await simpleParser(message.source);
      const sender = email.from?.value[0]?.address;
      // Ignore our own messages and automatic responses to avoid reply loops.
      if (
        !sender ||
        sender.toLowerCase() === process.env.IMAP_USER.toLowerCase() ||
        String(email.headers.get("auto-submitted") || "no").toLowerCase() !==
          "no"
      )
        continue;

      let text;
      let attachments = [];
      try {
        const request = await parseRequest(
          `${email.subject || ""}\n${email.text || ""}`,
          ai,
        );
        const folder = await mkdtemp(path.resolve("data/request-"));
        const result = await fetchMatter(request, folder);
        const zipPath = path.join(folder, `${request.matter}.zip`);
        await makeZip(result.files, zipPath);
        text = formatReply(result);
        attachments = [{ filename: `${request.matter}.zip`, path: zipPath }];
      } catch (error) {
        console.error(error);
        text = `I could not complete your request: ${error.message}\n\nPlease request one matter and one document type, e.g. Other Documents from M12205.`;
      }
      await smtp.sendMail({
        from: process.env.MAIL_FROM,
        to: sender,
        subject: `Re: ${email.subject || "Document request"}`,
        inReplyTo: email.messageId,
        headers: { "Auto-Submitted": "auto-replied" },
        text,
        attachments,
      });
      await inbox.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      console.log(`Replied to ${sender}`);
    }
  } finally {
    if (inbox.usable) await inbox.logout();
    else inbox.close();
  }
}

// Create the download folder once, then keep checking until Ctrl+C stops us.
await mkdir("data", { recursive: true });
console.log("Agent running. Checking the inbox every 15 seconds.");
while (true) {
  try {
    await checkInbox();
  } catch (error) {
    console.error("Email check failed:", error.message);
  }
  await sleep(15000);
}
