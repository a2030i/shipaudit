export default function handler(_request, response) {
  const publishableKey = String(process.env.VITE_HUDHUD_PUBLISHABLE_KEY || '').trim();
  const mapId = String(process.env.VITE_HUDHUD_MAP_ID || 'default').trim();
  response.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
  response.status(200).json({ publishableKey, mapId });
}
