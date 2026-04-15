# Melodia — AI Music SaaS (Cloudflare Tunnel + Node.js)

> Note: this repo now also includes a Cloudflare Worker + R2 deployment path that preserves Cover mode uploads without requiring the local Node tunnel setup.

> It can also be deployed to Render as a standard Node web service using `server.js`.

Powered by **TTAPI Suno API**. Runs on your local machine, exposed to the
internet via **Cloudflare Tunnel** so TTAPI can fetch your uploaded audio files.

---

## Architecture

```
Your browser
    │
    │  http://localhost:3000  (you open this in your browser)
    ▼
Express (Node.js) server
    │  public/uploads/   ← audio files saved here
    │
    │  https://melodia.yourdomain.com  (Cloudflare Tunnel exposes this)
    ▼
Cloudflare Edge → Cloudflare Tunnel → localhost:3000
    │
    │  TTAPI fetches your uploaded audio from the public HTTPS URL
    ▼
TTAPI → Suno AI → generated music returned to your browser
```

Your local audio files never leave your machine directly.
They are uploaded to the Express server (saving them to `public/uploads/`),
served via HTTPS through Cloudflare Tunnel, fetched once by TTAPI,
then automatically deleted.

---

## Prerequisites

- **Node.js** v18+ — https://nodejs.org
- **cloudflared** — the Cloudflare Tunnel client
- A domain on **Cloudflare DNS** (for a named tunnel with a fixed URL)

### Install cloudflared

```bash
# macOS
brew install cloudflared

# Linux (Debian/Ubuntu)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Windows
# Download cloudflared.exe from:
# https://github.com/cloudflare/cloudflared/releases/latest
```

---

## Setup — Option A: Named tunnel (recommended — permanent URL)

Use this if you have a domain on Cloudflare. You get a stable URL that never
changes, even across restarts.

### 1. Install dependencies

```bash
cd melodia
npm install
```

### 2. Log in to Cloudflare

```bash
cloudflared login
```

A browser window opens. Authorize with your Cloudflare account.

### 3. Create the tunnel (run once)

```bash
cloudflared tunnel create melodia
```

Output example:
```
Created tunnel melodia with id a1b2c3d4-e5f6-...
Credentials written to /home/you/.cloudflared/a1b2c3d4-e5f6-...json
```

Copy that tunnel ID.

### 4. Add a DNS route (run once)

```bash
cloudflared tunnel route dns melodia melodia.yourdomain.com
```

Replace `melodia.yourdomain.com` with your subdomain.
This creates a CNAME record in your Cloudflare DNS automatically.

### 5. Update the tunnel config

Open `cloudflare/config.yml` and replace:
- `TUNNEL_ID_HERE` → your actual tunnel ID (e.g. `a1b2c3d4-e5f6-...`)
- `melodia.yourdomain.com` → your actual subdomain

### 6. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```
PORT=3000
TTAPI_KEY=your_ttapi_key   # optional, you can enter it in the browser
PUBLIC_URL=https://melodia.yourdomain.com
```

### 7. Start everything

Open **two terminals**:

**Terminal 1 — Node.js server:**
```bash
node server.js
```

**Terminal 2 — Cloudflare Tunnel:**
```bash
cloudflared tunnel --config cloudflare/config.yml run
```

### 8. Open the app

Go to **http://localhost:3000** in your browser.

The green **Server online** badge confirms everything is connected.

---

## Setup — Option B: Quick temporary tunnel (no domain needed)

No Cloudflare account setup required. URL changes every time you restart the
tunnel, so you need to update `.env` each time.

### 1. Install dependencies + configure

```bash
npm install
cp .env.example .env
# Edit .env: set TTAPI_KEY (PUBLIC_URL comes from step 3)
```

### 2. Start the Node.js server

```bash
node server.js
```

### 3. Start the temporary tunnel

```bash
cloudflared tunnel --url http://localhost:3000
```

Output example:
```
Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):
https://random-words-here.trycloudflare.com
```

Copy that URL and update your `.env`:
```
PUBLIC_URL=https://random-words-here.trycloudflare.com
```

Then **restart the Node.js server** (Ctrl+C, then `node server.js` again) so
it picks up the new `PUBLIC_URL`.

### 4. Open the app

Go to **http://localhost:3000**.

---

## How file upload works in Cover mode

When you switch to Cover mode and choose **📁 Local file**:

1. You pick any audio file from your computer (MP3, WAV, FLAC, M4A, OGG, AAC — up to 100 MB)
2. The browser uploads it to `POST /api/upload` on your local Express server
3. Express saves it to `public/uploads/timestamp-random.mp3`
4. Express returns the public URL: `https://melodia.yourdomain.com/uploads/filename.mp3`
5. That URL is sent to TTAPI's `POST /suno/v1/upload` — TTAPI fetches the file
6. TTAPI returns a `music_id`
7. The `music_id` goes to TTAPI's `POST /suno/v1/cover` to generate the cover song
8. After TTAPI has fetched the file, it is automatically deleted from `public/uploads/`

---

## File structure

```
melodia/
├── server.js              Node.js Express server
├── package.json
├── .env.example           Config template
├── .env                   Your config (gitignored)
├── cloudflare/
│   └── config.yml         Cloudflare Tunnel config (named tunnel)
└── public/
    ├── index.html         Full frontend (single HTML file, no build step)
    └── uploads/           Uploaded audio files (auto-created, auto-cleaned)
```

---

## Cover mode controls

| Sidebar control | API field sent | What it does |
|---|---|---|
| Original audio weight (0–1) | `audio_weight` | Higher = preserves more of the original melody |
| Style strength (0–1) | `style_weight` | Higher = stronger style transformation |
| New style description | `tags` + `prompt` | Describes the reimagined style |
| Lyrics override (optional) | `prompt` | Replaces the original lyrics |
| Voice gender | `vocal_gender` | Forces Male or Female vocals |

---

## Troubleshooting

**"TTAPI could not fetch your audio"**
→ Cloudflare Tunnel is not running, or `PUBLIC_URL` in `.env` is not set / wrong.
→ Confirm the tunnel is running and `https://melodia.yourdomain.com` loads in a browser.

**Server badge shows "Server offline"**
→ Node.js server is not running. Run `node server.js`.

**"File too large"**
→ Default max is 100 MB. Increase `limits.fileSize` in `server.js` if needed.

**Uploaded file not deleted after generation**
→ The cleanup request is sent automatically but is non-critical.
→ You can manually clear `public/uploads/` at any time — it is safe to delete everything inside.
