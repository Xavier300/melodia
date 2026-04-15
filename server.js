require('dotenv').config();

const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const TTAPI_BASE = 'https://api.ttapi.io';
const DEFAULT_TTAPI_KEY = process.env.TTAPI_KEY || '';

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

function getTtapiKey(req) {
  return req.get('x-ttapi-key') || DEFAULT_TTAPI_KEY;
}

async function proxyTTAPI(req, res, endpoint) {
  const apiKey = getTtapiKey(req);
  if (!apiKey) {
    return res.status(400).json({ error: 'Missing TTAPI key.' });
  }

  try {
    const response = await fetch(`${TTAPI_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'TT-API-KEY': apiKey
      },
      body: JSON.stringify(req.body || {})
    });

    const text = await response.text();
    res.status(response.status);
    res.set('content-type', response.headers.get('content-type') || 'application/json; charset=utf-8');
    res.send(text);
  } catch (error) {
    console.error('[ttapi proxy]', endpoint, error.message);
    res.status(502).json({ error: 'Failed to reach TTAPI.', details: error.message });
  }
}

// FIX: express.static('public') already serves public/uploads/ at /uploads/.
// The previous second mount was redundant and could interfere with
// the DELETE /api/upload/:filename route handler.
app.use(express.static(path.join(__dirname, 'public')));

// ── Multer storage ────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase() || '.audio';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('audio/') ||
      ['.mp3','.wav','.flac','.m4a','.ogg','.aac','.weba','.opus']
        .includes(path.extname(file.originalname).toLowerCase());
    if (ok) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  }
});

// ── API Routes ────────────────────────────────────────────────

/**
 * POST /api/upload
 * Field name must be "audio" (matches index.html: form.append('audio', file, file.name))
 * Returns: { url, filename, originalName, size }
 */
app.post('/api/upload', (req, res) => {
  // FIX: wrap multer in the route callback so errors go to our handler,
  // not to Express's default uncaught-exception handler.
  upload.single('audio')(req, res, (err) => {
    if (err) {
      // FIX: explicit MulterError code for file size
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum size is 100 MB.' });
      }
      return res.status(400).json({ error: err.message || 'Upload failed.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file received. Field name must be "audio".' });
    }

    const base = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const url  = `${base}/uploads/${req.file.filename}`;

    console.log(`[upload] ${req.file.originalname} -> ${req.file.filename} (${(req.file.size/1024).toFixed(0)} KB)`);
    console.log(`[upload] Public URL: ${url}`);

    res.json({
      url,
      filename:     req.file.filename,
      originalName: req.file.originalname,
      size:         req.file.size
    });
  });
});

/**
 * DELETE /api/upload/:filename
 * Called by frontend cleanup after TTAPI fetches the file.
 * Returns 200 even if already deleted (cleanup is fire-and-forget).
 */
app.delete('/api/upload/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(__dirname, 'public', 'uploads', filename);

  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    console.log(`[upload] Deleted ${filename}`);
    res.json({ deleted: true, filename });
  } else {
    // Return 200 so frontend's fire-and-forget .catch(() => {}) doesn't trigger
    res.json({ deleted: false, filename, note: 'Already gone.' });
  }
});

/**
 * GET /api/status
 * Browser polls this every 15 s to drive the Server badge in the UI.
 * Returns tunnelConfigured: true only when PUBLIC_URL is set in .env.
 */
app.get('/api/status', (req, res) => {
  const base       = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  const files      = fs.existsSync(uploadsDir)
    ? fs.readdirSync(uploadsDir).filter(f => f !== '.gitkeep').length
    : 0;

  res.json({
    status:           'ok',
    publicUrl:        base,
    uploadsDir,
    filesStored:      files,
    tunnelConfigured: !!PUBLIC_URL
  });
});

app.post('/api/ttapi/music',  (req, res) => proxyTTAPI(req, res, '/suno/v1/music'));
app.post('/api/ttapi/upload', (req, res) => proxyTTAPI(req, res, '/suno/v1/upload'));
app.post('/api/ttapi/cover',  (req, res) => proxyTTAPI(req, res, '/suno/v1/cover'));
app.post('/api/ttapi/fetch',  (req, res) => proxyTTAPI(req, res, '/suno/v1/fetch'));
app.post('/api/ttapi/lyrics', (req, res) => proxyTTAPI(req, res, '/suno/v1/lyrics'));
app.post('/api/ttapi/wav',    (req, res) => proxyTTAPI(req, res, '/suno/v1/wav'));

// ── Error handler (MUST be before catch-all) ──────────────────
// FIX: previously this was after app.get('*') making it unreachable.
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error.' });
});

// Catch-all: serve index.html for SPA navigation (non-API routes)
// FIX: now correctly last, after all API routes and the error handler
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n  Melodia is running');
  console.log(`    Local:      http://localhost:${PORT}`);
  console.log(`    Public URL: ${PUBLIC_URL || '(not set -- add PUBLIC_URL to .env)'}`);
  if (!PUBLIC_URL) {
    console.log('\n  PUBLIC_URL not set. File uploads in Cover mode will fail.');
    console.log('  Start Cloudflare Tunnel, then set PUBLIC_URL in .env and restart.\n');
  } else {
    console.log('\n  Ready. Open http://localhost:' + PORT + '\n');
  }
});
