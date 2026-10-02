/**
 * api/twitchio.ts
 *
 * Handler Serverless para Vercel Functions para procesar eventos del bridge TwitchIO.
 * Compatible con PythonistaGuild TwitchIO event dispatch.
 */

export default function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { type, channel, data } = req.body || {};

  return res.status(200).json({
    status: 'ok',
    framework: 'TwitchIO (PythonistaGuild)',
    platform: 'vercel-serverless',
    receivedAt: Date.now(),
    type: type || 'event',
    channel: channel || 'global',
    data: data || null,
  });
}
