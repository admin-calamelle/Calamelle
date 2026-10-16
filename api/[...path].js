import app from '../backend/src/server.js';

export default function handler(req, res) {
  if (!String(req.url || '').startsWith('/api')) req.url = `/api${req.url || '/'}`;
  return app(req, res);
}
