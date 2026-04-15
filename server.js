require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Node 18+ has fetch globally.
// If you run Node < 18, uncomment:
// const fetch = (...args) => import('node-fetch').then(m => m.default(...args));

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const TTAPI_BASE = 'https://api.ttapi.io';
const DEFAULT_TTAPI_KEY = process.env.TTAPI_KEY || '';

// ────────────────────────────────────────────────────────────────
// Middleware
// ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve public files (index.html + uploads)
app.use(express.static(path.join(__dirname, 'public')));

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────
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
    res.set(
      'content-type',
      response.headers.get('content-type') ||
      'application/json; charset=utf-8'
    );
    res.send(text);
  } catch (err) {
    console.error('[TTAPI proxy]', endpoint, err.message);
    res.status(502).json({
      error: 'Failed to reach TTAPI',
      details: err.message
    });
  }
}

// ────────────────────────────────────────────────────────────────
// Multer (cover mode uploads)
// ────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.audio';
    const name = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype.startsWith('audio/') ||
      [
        '.mp3', '.wav', '.flac', '.m4a',
        '.ogg', '.aac', '.weba', '.opus'
      ].includes(path.extname(file.originalname).toLowerCase());

    ok ? cb(null, true) : cb(new Error('Unsupported audio type'));
  }
});

// ────────────────────────────────────────────────────────────────
// API endpoints
// ────────────────────────────────────────────────────────────────

// Upload for cover mode
app.post('/api/upload', (req, res) => {
  upload.single('audio')(req, res, err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 100MB)' });
      }
      return res.status(400).json({ error: err.message });
    }

    const base = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    res.json({
      url: `${base}/uploads/${req.file.filename}`,
      filename: req.file.filename,
      size: req.file.size
    });
  });
});

// Cleanup uploaded cover source
app.delete('/api/upload/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const fp = path.join(__dirname, 'public', 'uploads', filename);

  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ ok: true });
});

// Health check
app.get('/api/status', (req, res) => {
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  const files = fs.existsSync(uploadsDir)
    ? fs.readdirSync(uploadsDir).length
    : 0;

  res.json({
    status: 'ok',
    publicUrl: PUBLIC_URL || `${req.protocol}://${req.get('host')}`,
    filesStored: files,
    tunnelConfigured: !!PUBLIC_URL
  });
});

// TTAPI proxies
app.post('/api/ttapi/music',  (req, res) => proxyTTAPI(req, res, '/suno/v1/music'));
app.post('/api/ttapi/upload', (req, res) => proxyTTAPI(req, res, '/suno/v1/upload'));
app.post('/api/ttapi/cover',  (req, res) => proxyTTAPI(req, res, '/suno/v1/cover'));
app.post('/api/ttapi/fetch',  (req, res) => proxyTTAPI(req, res, '/suno/v1/fetch'));
app.post('/api/ttapi/lyrics', (req, res) => proxyTTAPI(req, res, '/suno/v1/lyrics'));
app.post('/api/ttapi/wav',    (req, res) => proxyTTAPI(req, res, '/suno/v1/wav'));

// ────────────────────────────────────────────────────────────────
// ✅ MP3 SAVE ENDPOINT (THE FIX)
