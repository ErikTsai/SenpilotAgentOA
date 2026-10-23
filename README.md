# Senpilot assignment MVP

JavaScript running on Node.js. One process reads an email, extracts the matter number and document type, downloads up to ten files from UARB, ZIPs them, and replies with the attachment, counts, and matter metadata.

## Setup

Requires Node.js 22+.

```powershell
npm ci
npx playwright install chromium
Copy-Item .env.example .env
```

Fill in the IMAP and SMTP settings for a dedicated agent inbox. Use an app password where your provider requires one. This MVP uses password authentication.

OpenAI is optional: setting `OPENAI_API_KEY` and `OPENAI_MODEL` enables interpretation of requests that do not use an exact document type. Otherwise use Exhibits, Key Documents, Other Documents, Transcripts, or Recordings explicitly, with a matter such as M12205.

## Run

```powershell
npm start
```

Leave it running and email the configured inbox:

> Hi Agent, can you give me Other Documents files from M12205?

It checks unread emails every 30 seconds and marks each request read after sending its reply. Ctrl+C stops it. To make it available continuously, run this command on an always-on server with Node.js and Chromium installed.

To test downloads without email credentials or sending anything:

```powershell
npm run preview -- "Other Documents from M12205"
```

The ZIP and reply text are saved in a new folder under `data/`.

## Read the code in this order

| File | What it does |
|---|---|
| `src/inbox.mjs` | Main loop: read email, call the steps below, reply. |
| `src/request.mjs` | Extract one matter and document type; optional OpenAI interpretation. |
| `src/uarb.mjs` | Navigate the website, collect metadata/counts, download up to ten files. |
| `src/files.mjs` | Create the ZIP and format the reply paragraph. |
| `scripts/preview.mjs` | Run the same collection steps locally without email. |

Libraries: Playwright (browser), ImapFlow (read email), mailparser (parse email), Nodemailer (send email), archiver (ZIP), openai (AI), dotenv (configuration).

## MVP limits

Run one instance against a dedicated inbox. Unread/read flags are the only processing state; if the process stops between sending and marking read, a reply can be duplicated. Files remain under `data/` for inspection. There is no queue, database, OAuth integration, or automatic attachment-size adjustment. Your mail provider's attachment limit applies, especially to recordings. The total is the sum of the five tab counts, not a count of unique contents across tabs.

The browser code retains the FileMaker-specific field selectors and waits needed for this website. Empty tabs produce an empty ZIP; individual failed downloads are listed in the reply. Website or parsing failures produce an error reply.

```powershell
npm test
```

Live email delivery and real OpenAI calls require credentials and have not been exercised here. Nonempty Transcript and Recording downloads remain unverified.
