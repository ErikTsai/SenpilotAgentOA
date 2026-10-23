# Senpilot Regulatory Document Agent

An email-driven agent that retrieves up to ten documents from the [Nova Scotia UARB public documents database](https://uarb.novascotia.ca/fmi/webd/UARB15), packages them into a ZIP, and replies with file counts and matter metadata. Runs locally or as a background service on an Oracle Cloud Ubuntu instance.

## Workflow

Send one matter number and one document type to the configured agent inbox:

> Hi Agent, can you give me Other Documents files from M12205?

```text
Unread email -> Extract request -> Search UARB -> Collect metadata and counts
            -> Download up to ten files -> ZIP -> Email reply -> Mark read
```

Supported types: **Exhibits, Key Documents, Other Documents, Transcripts, Recordings**. Matter numbers contain `M` followed by five digits, such as `M12205`.

Replies include title, type, category, status, outcome, date received, decision date, counts by tab, their total, and the number of attached files. Counts come from the live website, not hardcoded examples.

## Technology

| Technology | Purpose |
|---|---|
| JavaScript ES modules / Node.js 22+ | Runtime |
| Playwright + Chromium | Navigate FileMaker WebDirect and download files |
| ImapFlow | Read unread messages through IMAP |
| mailparser | Extract email sender, subject, and body |
| Nodemailer | Send SMTP replies and attachments |
| archiver | Create ZIP files |
| OpenAI API | Optional request interpretation |
| dotenv | Load configuration from `.env` |
| Oracle Cloud Infrastructure / Ubuntu | Host the continuously running worker |
| systemd | Start at boot and restart the worker |
| Node.js test runner | Automated tests |

Exact supported document names are parsed locally. OpenAI is called only when the exact type is not recognized and API credentials are configured. Its returned matter and type are validated. Website navigation, file operations, counts, and reply formatting use ordinary JavaScript; AI does not control recipients or invent metadata.

## Run locally

Install [Node.js 22+](https://nodejs.org/en/download), then run these commands from the project directory:

```powershell
npm ci
npx playwright install chromium
```

Create `.env` alongside `package.json`. For a dedicated Gmail inbox:

```dotenv
IMAP_HOST=imap.gmail.com
IMAP_USER=your-agent@gmail.com
IMAP_PASSWORD=your-google-app-password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-agent@gmail.com
SMTP_PASSWORD=your-google-app-password
MAIL_FROM=your-agent@gmail.com

# Optional. Leave both blank for exact document-type matching only.
OPENAI_API_KEY=
OPENAI_MODEL=

# Set false to watch the browser locally.
HEADLESS=true
```

Use the same Gmail account and app password for both protocols. Google app passwords require 2-Step Verification and may be restricted by account policy; follow [Google's instructions](https://support.google.com/accounts/answer/185833). Enter the generated app password without display spaces. Other providers require their own IMAP/SMTP settings; this MVP uses password authentication and IMAP port 993. For SMTP port 587, set `SMTP_SECURE=false` to use STARTTLS.

For AI interpretation, configure an OpenAI API key, API billing, and a model supporting Responses API structured outputs. Exact document-type matching does not require AI credentials.

### Start the inbox worker

```powershell
npm start
```

Expected output:

```text
Agent running. Checking the inbox every 30 seconds.
```

Send a new request from a different account. The worker handles requests one at a time, replies to the sender, and marks each processed request read. Leave the terminal running; Ctrl+C stops it. Restart after changing `.env`.

Use a dedicated inbox and leave incoming requests unread until processed. Collection takes additional time after the 30-second polling interval.

### Preview without sending email

```powershell
npm run preview -- "Other Documents from M12205"
```

Downloads files and saves a ZIP plus `reply.txt` under `data/`. It does not connect to the inbox or send email. Without AI configuration, use an exact supported document-type name.

### Tests

```powershell
npm test
```

Tests cover request extraction, ambiguity, validation of AI results, tab totals, reply content, and ZIP creation including empty tabs. External email delivery and real model calls are not included in the automated suite.

## Deploy on Oracle Cloud

For one user, a starting configuration is **VM.Standard.A1.Flex, 1 OCPU, 2 GB RAM, Ubuntu 24.04, and approximately 50 GB boot storage**. Select a public subnet, assign public IPv4 for SSH access, and download the SSH private key.

Check the account's current [Always Free allowances](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) before creating resources. This configuration can fit within them, but capacity is not guaranteed and idle free instances may be reclaimed. OpenAI API usage is a separate cost.

### Connect and upload

Run in **local PowerShell**, replacing the key path and server IP:

```powershell
ssh -i "C:\path\to\private-key.key" ubuntu@SERVER_IP
```

In the **Ubuntu SSH terminal**, create the destination:

```bash
mkdir -p ~/senpilot_agent
```

In a second **local PowerShell terminal**, from the project directory:

```powershell
scp -i "C:\path\to\private-key.key" -r src package.json package-lock.json ubuntu@SERVER_IP:~/senpilot_agent/
scp -i "C:\path\to\private-key.key" .env ubuntu@SERVER_IP:~/senpilot_agent/
```

SCP transfers `.env` over SSH. Do not commit it to GitHub. This copies what the running worker needs; also copy `scripts/` and `test/` if you want preview and test commands on the server.

### Install and test on the server

Install Node.js 22+ on Ubuntu. Then, in the **Ubuntu SSH terminal**, as the user who will run the service:

```bash
cd ~/senpilot_agent
chmod 600 .env
node --version
npm ci
npx playwright install --with-deps chromium
npm start
```

The Playwright command installs Chromium and its Linux dependencies; see [browser installation documentation](https://playwright.dev/docs/browsers). Test one request before configuring the service. Stop your local bot first so only one process reads the inbox.

### Keep it running with systemd

Stop the manual test with Ctrl+C. Run `which node` and use that absolute path in `ExecStart` below; this example assumes `/usr/bin/node`.

Create the service file on the server:

```bash
sudo nano /etc/systemd/system/senpilot.service
```

Paste:

```ini
[Unit]
Description=Senpilot regulatory document email agent
Wants=network-online.target
After=network-online.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/senpilot_agent
ExecStart=/usr/bin/node /home/ubuntu/senpilot_agent/src/inbox.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Adjust the username and project path if different. `WorkingDirectory` determines where `.env` is loaded and where `data/` is created.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now senpilot
sudo systemctl status senpilot
```

Look for `active (running)`. You can disconnect from SSH; systemd manages the worker. See [systemd documentation](https://freedesktop.org/software/systemd/man/latest/systemd.service.html).

```bash
sudo journalctl -u senpilot -f      # Watch logs; Ctrl+C exits the viewer only
sudo systemctl restart senpilot    # Reload after code or .env changes
sudo systemctl stop senpilot       # Stop
sudo systemctl start senpilot      # Start
```

After uploading source changes, restart the service. Run `npm ci` first if dependencies changed. systemd cannot keep the bot available when the cloud instance itself is stopped or reclaimed.

## Code and storage

| File | Responsibility |
|---|---|
| `src/inbox.mjs` | Main loop: read email, coordinate collection, send reply |
| `src/request.mjs` | Extract and validate request; optional OpenAI fallback |
| `src/uarb.mjs` | Search UARB, read metadata/counts, download documents |
| `src/files.mjs` | ZIP creation and reply formatting |
| `scripts/preview.mjs` | Local collection without email |
| `test/core.test.mjs` | Automated tests |

Each request creates a unique folder under the working directory:

```text
data/
  request-<random>/
    1-document.pdf
    2-document.pdf
    M12205.zip
  preview-<random>/
    ...downloaded files...
    M12205.zip
    reply.txt
```

Playwright downloads into temporary browser storage first. `download.saveAs()` saves our copies into the request folder. The ZIP is created in the same folder, and Nodemailer reads it from disk. Files remain after sending. On Oracle, they live on the server, not the developer's laptop.

`.env`, `node_modules/`, `data/`, `artifacts/`, and logs are excluded from Git. Never upload credentials or SSH private keys to GitHub.

## MVP limits

- Run one worker against one dedicated inbox. Read/unread flags are the only processing state; stopping between sending and marking read can cause duplicate replies.
- Downloads up to ten files in the displayed order. Individual failures are listed; empty tabs produce an empty ZIP.
- Totals count document entries across the five tabs, not unique contents across tabs.
- No database, queue, OAuth integration, or automatic attachment resizing. Provider attachment limits apply, especially to recordings.
- FileMaker-specific selectors may need updating if the website changes.
- Downloaded files accumulate on disk and require occasional cleanup.
- Live collection checks covered Other Documents, Key Documents, Exhibits, and an empty tab. Nonempty Transcript and Recording downloads remain unverified.
