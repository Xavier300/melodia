const MAX_FILE_SIZE = 100 * 1024 * 1024;
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac', '.weba', '.opus']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/status' && request.method === 'GET') {
      return json({
        status: 'ok',
        publicUrl: url.origin,
        uploadsDir: 'r2://melodia-uploads',
        filesStored: null,
        tunnelConfigured: true,
        storage: 'r2'
      });
    }

    if (url.pathname === '/api/upload' && request.method === 'POST') {
      return handleUpload(request, env, url);
    }

    if (url.pathname.startsWith('/api/upload/') && request.method === 'DELETE') {
      const filename = decodeURIComponent(url.pathname.slice('/api/upload/'.length)).split('/').pop();
      if (!filename) return json({ error: 'Missing filename.' }, 400);
      await env.UPLOADS.delete(filename);
      return json({ deleted: true, filename });
    }

    if (url.pathname.startsWith('/uploads/') && request.method === 'GET') {
      const key = decodeURIComponent(url.pathname.slice('/uploads/'.length));
      if (!key) return new Response('Not found', { status: 404 });
      const object = await env.UPLOADS.get(key);
      if (!object) return new Response('Not found', { status: 404 });

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('cache-control', 'public, max-age=3600');
      return new Response(object.body, { headers });
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleUpload(request, env, url) {
  const formData = await request.formData();
  const file = formData.get('audio');

  if (!(file instanceof File)) {
    return json({ error: 'No audio file received. Field name must be "audio".' }, 400);
  }

  if (file.size > MAX_FILE_SIZE) {
    return json({ error: 'File too large. Maximum size is 100 MB.' }, 413);
  }

  const name = file.name || 'upload.audio';
  const ext = extname(name).toLowerCase();
  if (!(file.type?.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext))) {
    return json({ error: `Unsupported file type: ${file.type || 'unknown'}` }, 400);
  }

  const filename = `${Date.now()}-${crypto.randomUUID()}${ext || '.audio'}`;
  await env.UPLOADS.put(filename, file.stream(), {
    httpMetadata: {
      contentType: file.type || 'application/octet-stream'
    },
    customMetadata: {
      originalName: name
    }
  });

  return json({
    url: `${url.origin}/uploads/${filename}`,
    filename,
    originalName: name,
    size: file.size
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  });
}

function extname(name) {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx) : '';
}