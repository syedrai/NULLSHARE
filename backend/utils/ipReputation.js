// utils/ipReputation.js
// NullShare — IP Reputation & Geolocation
//
// Integrates two public APIs (from public-apis/public-apis):
//
//   1. ipapi.co  — Free IP geolocation (no key, 1000 req/day)
//                  https://ipapi.co/api/#introduction
//                  Returns: country, city, org, timezone
//
//   2. AbuseIPDB — IP reputation / abuse score (apiKey, 1000 req/day free)
//                  https://docs.abuseipdb.com/
//                  Returns: abuseConfidenceScore (0-100), ISP, usage type
//
// Both are called async and cached in-memory (TTL: 1 hour) to avoid
// hammering the APIs on repeated access from the same IP.
//
// Usage:
//   const { enrichIP } = require('./ipReputation');
//   const info = await enrichIP('1.2.3.4');
//   // { country: 'US', city: 'New York', org: 'AS...', abuseScore: 0, flag: '🇺🇸' }

const https = require('https');

// ─── In-memory cache ──────────────────────────────────────────────────────────
const cache = new Map(); // ip → { data, expiresAt }
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Skip enrichment for private/loopback IPs
const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^localhost$/,
  /^unknown$/
];

function isPrivateIP(ip) {
  return PRIVATE_RANGES.some(r => r.test(ip));
}

// ─── Simple HTTPS GET helper ──────────────────────────────────────────────────
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: 4000 }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ─── ipapi.co — free geolocation, no key needed ───────────────────────────────
async function getGeoInfo(ip) {
  try {
    // https://ipapi.co/api/#introduction — free, no key, 1000/day
    const data = await httpsGet(`https://ipapi.co/${ip}/json/`, {
      'User-Agent': 'NullShare/2.0'
    });
    if (data.error) return null;
    return {
      country: data.country_code || '??',
      countryName: data.country_name || 'Unknown',
      city: data.city || '',
      region: data.region || '',
      org: data.org || '',
      timezone: data.timezone || '',
      flag: countryFlag(data.country_code)
    };
  } catch {
    return null;
  }
}

// ─── AbuseIPDB — IP reputation score ─────────────────────────────────────────
async function getAbuseScore(ip) {
  const apiKey = process.env.ABUSEIPDB_KEY;
  if (!apiKey) return null;
  try {
    // https://docs.abuseipdb.com/#check-endpoint
    const data = await httpsGet(
      `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`,
      { Key: apiKey, Accept: 'application/json' }
    );
    if (!data.data) return null;
    return {
      abuseScore: data.data.abuseConfidenceScore,   // 0–100
      isp: data.data.isp || '',
      usageType: data.data.usageType || '',
      totalReports: data.data.totalReports || 0,
      isWhitelisted: data.data.isWhitelisted || false
    };
  } catch {
    return null;
  }
}

// ─── Country code → emoji flag ────────────────────────────────────────────────
function countryFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  // Each letter maps to a regional indicator symbol (U+1F1E6 + offset)
  const offset = 0x1F1E6 - 65;
  return String.fromCodePoint(code.charCodeAt(0) + offset) +
         String.fromCodePoint(code.charCodeAt(1) + offset);
}

// ─── Main export: enrich an IP with geo + reputation ─────────────────────────
async function enrichIP(ip) {
  if (!ip || isPrivateIP(ip)) {
    return { country: 'LAN', city: 'Local', flag: '🏠', abuseScore: 0, org: 'Private Network' };
  }

  // Check cache
  const cached = cache.get(ip);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  // Fetch both in parallel
  const [geo, abuse] = await Promise.allSettled([getGeoInfo(ip), getAbuseScore(ip)]);

  const result = {
    country: '??',
    countryName: 'Unknown',
    city: '',
    org: '',
    flag: '🌐',
    abuseScore: null,
    isp: '',
    totalReports: 0
  };

  if (geo.status === 'fulfilled' && geo.value) Object.assign(result, geo.value);
  if (abuse.status === 'fulfilled' && abuse.value) Object.assign(result, abuse.value);

  // Cache result
  cache.set(ip, { data: result, expiresAt: Date.now() + CACHE_TTL });
  // Evict old entries if cache grows large
  if (cache.size > 5000) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    cache.delete(oldest[0]);
  }

  return result;
}

// ─── Batch enrich (for log history export) ───────────────────────────────────
async function enrichIPs(ips) {
  const unique = [...new Set(ips)];
  const results = await Promise.allSettled(unique.map(ip => enrichIP(ip)));
  const map = {};
  unique.forEach((ip, i) => {
    map[ip] = results[i].status === 'fulfilled' ? results[i].value : { flag: '🌐', country: '??' };
  });
  return map;
}

module.exports = { enrichIP, enrichIPs, countryFlag };
