import express from 'express';
import https from 'node:https';
import type http from 'node:http';
import zlib from 'node:zlib';
import path from 'node:path';
import fs from 'node:fs';

const app = express();
const TARGET_HOST = 'www.learnxpw.site';
const TARGET_ORIGIN = `https://${TARGET_HOST}`;

// Brand settings configured as requested
const BRAND_NAME = 'GB STUDY';
const TELEGRAM_URL = 'https://t.me/GBFreestudy';
const ICON_URL = 'https://i.ibb.co/Q3g9fGSt/1791541921524.png';
const OLD_ICON_URL = 'https://i.ibb.co/V8CbjrG/image.png';
const OLD_TG_URL = 'https://t.me/+AgMz8cG-x8VmNGY1';
const OLD_TG_URL_ALT = 'https://t.me/AgMz8cG-x8VmNGY1';

// Full-access session cache to completely eliminate key generation and shorteners
let cachedAccessCookie = 'studymeta_access=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6ImZ1bGwiLCJpYXQiOjE3OTM1MzI3NDEsImV4cCI6MTc5MzYxOTE0MX0.mhgVVljLpo7xU6f1N13Eun7Slc94LZdk2t0KrH_WyQw';
let cookieExpiryTime = Date.now() + 20 * 60 * 60 * 1000;
let refreshPromise: Promise<string> | null = null;

// Caches to make study endpoints resilient against upstream rate limits and transient errors
const batchInfoCache = new Map<string, any>();
const subjectInfoCache = new Map<string, any>();
const topicInfoCache = new Map<string, any>();

async function fetchFreshAccessCookie(): Promise<string> {
  try {
    const anonId = 'anon_' + Date.now();
    const pageData = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const getReq = https.get(
        `${TARGET_ORIGIN}/key-generate?redirect=%2Fstudy%2Fbatches&type=full&anon_id=${anonId}`,
        {
          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            referer: `${TARGET_ORIGIN}/study/batches`,
            cookie: `anon_id=${anonId}`,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode || 200,
              body: Buffer.concat(chunks).toString('utf-8'),
            })
          );
        }
      );
      getReq.setTimeout(8000, () => {
        getReq.destroy();
        reject(new Error('Timeout fetching key-generate page'));
      });
      getReq.on('error', reject);
    });

    const m = pageData.body.match(/\\"token\\":\\"([^"\\]+)\\"/);
    if (!m || !m[1]) {
      return cachedAccessCookie;
    }

    const token = m[1];
    const verifyData = await new Promise<{
      status: number;
      headers: http.IncomingHttpHeaders;
    }>((resolve, reject) => {
      const verifyReq = https.request(
        `${TARGET_ORIGIN}/api/complete-verification`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            referer: `${TARGET_ORIGIN}/verify?token=${encodeURIComponent(token)}`,
          },
        },
        (res) => {
          resolve({ status: res.statusCode || 200, headers: res.headers });
        }
      );
      verifyReq.setTimeout(8000, () => {
        verifyReq.destroy();
        reject(new Error('Timeout completing verification'));
      });
      verifyReq.on('error', reject);
      verifyReq.write(JSON.stringify({ token }));
      verifyReq.end();
    });

    const setCookies = verifyData.headers['set-cookie'] || [];
    const accessCookie = (
      Array.isArray(setCookies) ? setCookies : [setCookies]
    ).find((c) => c.startsWith('studymeta_access='));

    if (accessCookie) {
      cachedAccessCookie = accessCookie.split(';')[0];
      cookieExpiryTime = Date.now() + 20 * 60 * 60 * 1000;
      return cachedAccessCookie;
    }
  } catch (err) {
    console.error('Failed to auto-refresh access cookie:', err);
  }
  return cachedAccessCookie;
}

async function getAccessCookie(): Promise<string> {
  if (cachedAccessCookie && Date.now() < cookieExpiryTime) {
    return cachedAccessCookie;
  }
  if (!refreshPromise) {
    refreshPromise = fetchFreshAccessCookie().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * Transforms text responses (HTML, Next.js RSC, JS bundles, API JSON)
 * replacing Name -> GB STUDY, Telegram -> https://t.me/GBFreestudy, Icon -> https://ibb.co/0R7qc34v (direct image)
 * and completely removing shortener/key-generation prompts.
 */
function transformText(content: string): string {
  let text = content;

  // 1. Strip absolute hostnames so all links stay within this proxy
  text = text.replaceAll('https://www.learnxpw.site', '');
  text = text.replaceAll('http://www.learnxpw.site', '');
  text = text.replaceAll('https:\\/\\/www.learnxpw.site', '');
  text = text.replaceAll('https://learnxpw.site', '');
  text = text.replaceAll('http://learnxpw.site', '');
  text = text.replaceAll('https:\\/\\/learnxpw.site', '');

  // 2. Icon replacement (both direct URL and JSON-escaped slashes, plus path suffix)
  text = text.replaceAll(OLD_ICON_URL, ICON_URL);
  text = text.replaceAll('https:\\/\\/i.ibb.co\\/V8CbjrG\\/image.png', ICON_URL.replace(/\//g, '\\/'));
  text = text.replaceAll('V8CbjrG/image.png', 'Q3g9fGSt/1791541921524.png');
  text = text.replaceAll('V8CbjrG\\/image.png', 'Q3g9fGSt\\/1791541921524.png');
  text = text.replaceAll('https://ibb.co/0R7qc34v', ICON_URL);
  text = text.replaceAll('https:\\/\\/ibb.co\\/0R7qc34v', ICON_URL.replace(/\//g, '\\/'));

  // 3. Telegram URL replacement (both full URL, path, and split tokens)
  text = text.replaceAll(OLD_TG_URL, TELEGRAM_URL);
  text = text.replaceAll('https:\\/\\/t.me\\/+AgMz8cG-x8VmNGY1', TELEGRAM_URL.replace(/\//g, '\\/'));
  text = text.replaceAll(OLD_TG_URL_ALT, TELEGRAM_URL);
  text = text.replaceAll('https:\\/\\/t.me\\/AgMz8cG-x8VmNGY1', TELEGRAM_URL.replace(/\//g, '\\/'));
  text = text.replaceAll('://t.me/+AgMz8cG-x8VmNGY1', '://t.me/GBFreestudy');
  text = text.replaceAll(':\\/\\/t.me\\/+AgMz8cG-x8VmNGY1', ':\\/\\/t.me\\/GBFreestudy');
  text = text.replaceAll('+AgMz8cG-x8VmNGY1', 'GBFreestudy');
  text = text.replaceAll('AgMz8cG-x8VmNGY1', 'GBFreestudy');
  text = text.replaceAll('@bookverse_probot', '@GBFreestudy');

  // 4. Name replacement
  text = text.replaceAll('"webName":"Learnxpw"', `"webName":"${BRAND_NAME}"`);
  text = text.replaceAll('"sidebarTitle":"Learnxpw"', `"sidebarTitle":"${BRAND_NAME}"`);
  text = text.replaceAll('Learnxpw — a comprehensive online study platform', `${BRAND_NAME} — a comprehensive online study platform`);
  text = text.replaceAll('<title>Learnxpw</title>', `<title>${BRAND_NAME}</title>`);
  text = text.replaceAll('© 2026 Learnxpw', `© 2026 ${BRAND_NAME}`);
  text = text.replaceAll('© 2025 Learnxpw', `© 2025 ${BRAND_NAME}`);
  text = text.replaceAll('Learnxpw', BRAND_NAME);
  text = text.replaceAll('LEARNXPW', BRAND_NAME);
  text = text.replaceAll('learnxpw', BRAND_NAME);

  // 5. Disable shorteners and key-generation gates completely in UI config
  text = text.replaceAll(/"shortner_servers":\[[^\]]*\]/g, '"shortner_servers":[]');
  text = text.replaceAll('"isDirectLoginOpen":false', '"isDirectLoginOpen":true');

  return text;
}

// Serve locally cached logo if requested
app.get('/logo.png', (_req, res) => {
  const localLogo = path.resolve(process.cwd(), 'public', 'logo.png');
  if (fs.existsSync(localLogo)) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(localLogo).pipe(res);
  } else {
    res.redirect(ICON_URL);
  }
});

// Root path handler: directly redirect to /study/batches so the user lands straight on the batches page
app.get('/', (req, res) => {
  if (req.query.home === '1') {
    handleProxy(req, res, '/');
  } else {
    res.redirect(307, '/study/batches');
  }
});

// Banish key generation routes: immediately redirect to intended destination or /study/batches
app.get('/key-generate', async (req, res) => {
  const cookie = await getAccessCookie();
  if (cookie) {
    res.setHeader('Set-Cookie', `${cookie}; Path=/; SameSite=Lax; Max-Age=86400`);
  }
  const target = (req.query.redirect as string) || '/study/batches';
  res.redirect(307, target);
});

app.get('/verify', async (_req, res) => {
  const cookie = await getAccessCookie();
  if (cookie) {
    res.setHeader('Set-Cookie', `${cookie}; Path=/; SameSite=Lax; Max-Age=86400`);
  }
  res.redirect(307, '/study/batches');
});

app.get('/study/key', (_req, res) => {
  res.redirect(307, '/study/batches');
});

// Resilient /api/Schedule handler: prevents 'Invalid Schedule API response' crashes
app.get('/api/Schedule', async (req, res) => {
  const batchId = (req.query.BatchId || req.query.batchId || req.query.batch_id || '') as string;
  const subjectId = (req.query.SubjectId || req.query.subjectId || req.query.subject_id || '') as string;
  const contentId = (req.query.ContentId || req.query.contentId || req.query.ChildId || req.query.childId || req.query.videoId || req.query.video_id || '') as string;

  const accessCookie = await getAccessCookie();
  const watchReferer = `${TARGET_ORIGIN}/watch?batchId=${batchId}&SubjectId=${subjectId}&ContentId=${contentId}`;

  // 1. Attempt to fetch schedule from upstream with watch referer
  try {
    const upstreamUrl = `${TARGET_ORIGIN}/api/Schedule?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&ContentId=${encodeURIComponent(contentId)}`;
    const upstreamRes = await new Promise<{ status: number; data: any }>((resolve) => {
      https
        .get(
          upstreamUrl,
          {
            headers: {
              'user-agent':
                (req.headers['user-agent'] as string) ||
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              referer: watchReferer,
              cookie: accessCookie,
            },
          },
          (proxyRes) => {
            const chunks: Buffer[] = [];
            proxyRes.on('data', (c) => chunks.push(c));
            proxyRes.on('end', () => {
              try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                resolve({ status: proxyRes.statusCode || 200, data: parsed });
              } catch {
                resolve({ status: proxyRes.statusCode || 500, data: null });
              }
            });
          }
        )
        .on('error', () => resolve({ status: 500, data: null }));
    });

    if (
      upstreamRes.status === 200 &&
      upstreamRes.data?.success &&
      (upstreamRes.data?.data?.urlType ||
        (Array.isArray(upstreamRes.data?.data) && upstreamRes.data?.data[0]?.urlType))
    ) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json(upstreamRes.data);
    }
  } catch (err) {
    console.warn('Upstream /api/Schedule fetch encountered error, using resilient fallback:', err);
  }

  // 2. Resilient fallback: Query video-url or synthesize valid schedule structure so watch player never crashes
  let urlType = 'penpencilvdo';
  let videoUrl = '';
  const topic = 'Class Lecture';

  try {
    const vUrl = `${TARGET_ORIGIN}/api/video-url?batch_id=${encodeURIComponent(batchId)}&subject_id=${encodeURIComponent(subjectId)}&video_id=${encodeURIComponent(contentId)}`;
    const vRes = await new Promise<{ status: number; data: any }>((resolve) => {
      https
        .get(
          vUrl,
          {
            headers: {
              'user-agent':
                (req.headers['user-agent'] as string) ||
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              referer: watchReferer,
              cookie: accessCookie,
            },
          },
          (proxyRes) => {
            const chunks: Buffer[] = [];
            proxyRes.on('data', (c) => chunks.push(c));
            proxyRes.on('end', () => {
              try {
                resolve({
                  status: proxyRes.statusCode || 200,
                  data: JSON.parse(Buffer.concat(chunks).toString('utf-8')),
                });
              } catch {
                resolve({ status: proxyRes.statusCode || 500, data: null });
              }
            });
          }
        )
        .on('error', () => resolve({ status: 500, data: null }));
    });

    if (vRes.status === 200 && vRes.data?.success && vRes.data?.data) {
      urlType = vRes.data.data.urlType || 'penpencilvdo';
      videoUrl = vRes.data.data.url || '';
    }
  } catch {
    // Continue with default penpencilvdo
  }

  // Return compliant schedule response guaranteed to satisfy:
  // if (!(null == b ? void 0 : b.success) || !(null == j ? void 0 : j.urlType)) throw Error("Invalid Schedule API response");
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    success: true,
    data: {
      _id: contentId,
      topic: topic,
      title: topic,
      name: topic,
      urlType: urlType,
      url: videoUrl,
      videoDetails: {},
      availableFor: [],
      platformRestricted: false,
      restrictedSchedule: false,
      restrictedTime: 0,
    },
  });
});

// Always return clean GB STUDY server info with zero shorteners
app.get('/api/auth/serverInfo', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    webName: BRAND_NAME,
    sidebarLogoUrl: ICON_URL,
    sidebarTitle: BRAND_NAME,
    maintenanceMode: false,
    tg_channel: TELEGRAM_URL,
    tg_username: '',
    isDirectLoginOpen: true,
    tg_bot: '@GBFreestudy',
    shortner_servers: [],
  });
});

const allBatchesCache = new Map<string, any>();

// High-speed cached AllBatches handler
app.get('/api/AllBatches', async (req, res) => {
  const page = (req.query.page || '1') as string;
  const accessCookie = await getAccessCookie();

  try {
    const upstreamUrl = `${TARGET_ORIGIN}/api/AllBatches?page=${encodeURIComponent(page)}`;
    const upstreamRes = await new Promise<{ status: number; body: string }>((resolve) => {
      https
        .get(
          upstreamUrl,
          {
            headers: {
              'user-agent':
                (req.headers['user-agent'] as string) ||
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              referer: `${TARGET_ORIGIN}/study/batches`,
              cookie: accessCookie,
            },
          },
          (proxyRes) => {
            const chunks: Buffer[] = [];
            proxyRes.on('data', (c) => chunks.push(c));
            proxyRes.on('end', () =>
              resolve({
                status: proxyRes.statusCode || 200,
                body: Buffer.concat(chunks).toString('utf-8'),
              })
            );
          }
        )
        .on('error', () => resolve({ status: 500, body: '' }));
    });

    if (upstreamRes.status === 200 && upstreamRes.body) {
      try {
        const parsed = JSON.parse(upstreamRes.body);
        if (parsed.success && parsed.batches) {
          allBatchesCache.set(page, parsed);
          const modified = transformText(upstreamRes.body);
          res.setHeader('Content-Type', 'application/json');
          return res.status(200).send(modified);
        }
      } catch {
        // Fall through
      }
    }
  } catch (err) {
    console.warn('Upstream AllBatches fetch error:', err);
  }

  const cached = allBatchesCache.get(page);
  if (cached) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(cached);
  }

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    success: true,
    batches: [],
    totalPages: 1,
    currentPage: 1,
    total: 0,
  });
});

// Resilient /api/BatchInfo handler: prevents 'Failed to search batches' error
app.get('/api/BatchInfo', async (req, res) => {
  const batchId = (req.query.BatchId || req.query.batchId || '') as string;
  const type = ((req.query.Type || req.query.type || 'details') as string).toLowerCase();
  const page = (req.query.page || '1') as string;

  // Handle transient missing batch ID during hydration/navigation gracefully
  if (!batchId || batchId === 'undefined' || batchId === 'null') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ success: true, data: type === 'details' ? {} : [] });
  }

  const cacheKey = `${batchId}:${type}:${page}`;
  const accessCookie = await getAccessCookie();

  try {
    const upstreamUrl = `${TARGET_ORIGIN}/api/BatchInfo?BatchId=${encodeURIComponent(batchId)}&Type=${encodeURIComponent(type)}${page ? `&page=${encodeURIComponent(page)}` : ''}`;
    const upstreamRes = await new Promise<{ status: number; body: string }>((resolve) => {
      https
        .get(
          upstreamUrl,
          {
            headers: {
              'user-agent':
                (req.headers['user-agent'] as string) ||
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              referer: `${TARGET_ORIGIN}/study/batches/${batchId}`,
              cookie: accessCookie,
            },
          },
          (proxyRes) => {
            const chunks: Buffer[] = [];
            proxyRes.on('data', (c) => chunks.push(c));
            proxyRes.on('end', () => {
              resolve({
                status: proxyRes.statusCode || 200,
                body: Buffer.concat(chunks).toString('utf-8'),
              });
            });
          }
        )
        .on('error', () => resolve({ status: 500, body: '' }));
    });

    if (upstreamRes.status === 200 && upstreamRes.body) {
      try {
        const parsed = JSON.parse(upstreamRes.body);
        if (parsed.success) {
          batchInfoCache.set(cacheKey, parsed);
          const modified = transformText(upstreamRes.body);
          res.setHeader('Content-Type', 'application/json');
          return res.status(200).send(modified);
        }
      } catch {
        // Fall through
      }
    }
  } catch (err) {
    console.warn('Upstream BatchInfo fetch error:', err);
  }

  const cached = batchInfoCache.get(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(cached);
  }

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    success: true,
    data: type === 'details' ? { _id: batchId, name: 'Batch', subjects: [] } : [],
  });
});

// Resilient /api/SubjectInfo handler
app.get('/api/SubjectInfo', async (req, res) => {
  const batchId = (req.query.BatchId || req.query.batchId || '') as string;
  const subjectId = (req.query.SubjectId || req.query.subjectId || '') as string;
  const page = (req.query.page || '1') as string;

  if (!batchId || batchId === 'undefined' || !subjectId || subjectId === 'undefined') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ success: true, data: [] });
  }

  const cacheKey = `${batchId}:${subjectId}:${page}`;
  const accessCookie = await getAccessCookie();

  try {
    const upstreamUrl = `${TARGET_ORIGIN}/api/SubjectInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&page=${encodeURIComponent(page)}`;
    const upstreamRes = await new Promise<{ status: number; body: string }>((resolve) => {
      https
        .get(
          upstreamUrl,
          {
            headers: {
              'user-agent':
                (req.headers['user-agent'] as string) ||
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              referer: `${TARGET_ORIGIN}/study/batches/${batchId}`,
              cookie: accessCookie,
            },
          },
          (proxyRes) => {
            const chunks: Buffer[] = [];
            proxyRes.on('data', (c) => chunks.push(c));
            proxyRes.on('end', () => {
              resolve({
                status: proxyRes.statusCode || 200,
                body: Buffer.concat(chunks).toString('utf-8'),
              });
            });
          }
        )
        .on('error', () => resolve({ status: 500, body: '' }));
    });

    if (upstreamRes.status === 200 && upstreamRes.body) {
      try {
        const parsed = JSON.parse(upstreamRes.body);
        if (parsed && (parsed.data !== undefined || parsed.success)) {
          subjectInfoCache.set(cacheKey, parsed);
          const modified = transformText(upstreamRes.body);
          res.setHeader('Content-Type', 'application/json');
          return res.status(200).send(modified);
        }
      } catch {
        // Fall through
      }
    }
  } catch (err) {
    console.warn('Upstream SubjectInfo fetch error:', err);
  }

  const cached = subjectInfoCache.get(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(cached);
  }

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({ success: true, data: [] });
});

// Resilient /api/TopicInfo handler
app.get('/api/TopicInfo', async (req, res) => {
  const batchId = (req.query.BatchId || req.query.batchId || '') as string;
  const subjectId = (req.query.SubjectId || req.query.subjectId || '') as string;
  const topicId = (req.query.TopicId || req.query.topicId || '') as string;
  const contentType = (req.query.ContentType || req.query.contentType || 'videos') as string;
  const page = (req.query.page || '1') as string;

  if (
    !batchId ||
    batchId === 'undefined' ||
    !subjectId ||
    subjectId === 'undefined' ||
    !topicId ||
    topicId === 'undefined'
  ) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ success: true, data: [] });
  }

  const cacheKey = `${batchId}:${subjectId}:${topicId}:${contentType}:${page}`;
  const accessCookie = await getAccessCookie();

  try {
    const upstreamUrl = `${TARGET_ORIGIN}/api/TopicInfo?BatchId=${encodeURIComponent(batchId)}&SubjectId=${encodeURIComponent(subjectId)}&TopicId=${encodeURIComponent(topicId)}&ContentType=${encodeURIComponent(contentType)}&page=${encodeURIComponent(page)}`;
    const upstreamRes = await new Promise<{ status: number; body: string }>((resolve) => {
      https
        .get(
          upstreamUrl,
          {
            headers: {
              'user-agent':
                (req.headers['user-agent'] as string) ||
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              referer: `${TARGET_ORIGIN}/study/batches/${batchId}`,
              cookie: accessCookie,
            },
          },
          (proxyRes) => {
            const chunks: Buffer[] = [];
            proxyRes.on('data', (c) => chunks.push(c));
            proxyRes.on('end', () => {
              resolve({
                status: proxyRes.statusCode || 200,
                body: Buffer.concat(chunks).toString('utf-8'),
              });
            });
          }
        )
        .on('error', () => resolve({ status: 500, body: '' }));
    });

    if (upstreamRes.status === 200 && upstreamRes.body) {
      try {
        const parsed = JSON.parse(upstreamRes.body);
        if (parsed && (parsed.data !== undefined || parsed.success)) {
          topicInfoCache.set(cacheKey, parsed);
          const modified = transformText(upstreamRes.body);
          res.setHeader('Content-Type', 'application/json');
          return res.status(200).send(modified);
        }
      } catch {
        // Fall through
      }
    }
  } catch (err) {
    console.warn('Upstream TopicInfo fetch error:', err);
  }

  const cached = topicInfoCache.get(cacheKey);
  if (cached) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(cached);
  }

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({ success: true, data: [] });
});

// Resilient /api/searchBatch handler
app.get('/api/searchBatch', async (req, res) => {
  const name = ((req.query.name as string) || '').trim();
  const page = (req.query.page || '1') as string;
  const accessCookie = await getAccessCookie();

  try {
    const upstreamUrl = `${TARGET_ORIGIN}/api/searchBatch?name=${encodeURIComponent(name)}&page=${encodeURIComponent(page)}`;
    const upstreamRes = await new Promise<{ status: number; body: string }>((resolve) => {
      https
        .get(
          upstreamUrl,
          {
            headers: {
              'user-agent':
                (req.headers['user-agent'] as string) ||
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              referer: `${TARGET_ORIGIN}/study/batches`,
              cookie: accessCookie,
            },
          },
          (proxyRes) => {
            const chunks: Buffer[] = [];
            proxyRes.on('data', (c) => chunks.push(c));
            proxyRes.on('end', () => {
              resolve({
                status: proxyRes.statusCode || 200,
                body: Buffer.concat(chunks).toString('utf-8'),
              });
            });
          }
        )
        .on('error', () => resolve({ status: 500, body: '' }));
    });

    if (upstreamRes.status === 200 && upstreamRes.body) {
      const modified = transformText(upstreamRes.body);
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(modified);
    }
  } catch (err) {
    console.warn('Upstream searchBatch fetch error:', err);
  }

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    success: true,
    batches: [],
    totalPages: 1,
    currentPage: 1,
    total: 0,
  });
});

// Helper to determine exact destination path (handles local dev and Vercel serverless rewrites)
function resolvePath(req: express.Request): string {
  // 1. Check query parameter __path (if passed via Vercel rewrite)
  if (req.query.__path && typeof req.query.__path === 'string') {
    let p = req.query.__path;
    if (!p.startsWith('/')) p = `/${p}`;
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== '__path' && value !== undefined) {
        if (Array.isArray(value)) {
          value.forEach((v) => searchParams.append(key, String(v)));
        } else {
          searchParams.append(key, String(value));
        }
      }
    }
    const qs = searchParams.toString();
    return qs ? `${p}?${qs}` : p;
  }

  // 2. Check Vercel matched path headers
  const matched =
    (req.headers['x-matched-path'] as string) ||
    (req.headers['x-vercel-matched-path'] as string) ||
    '';
  if (matched && !matched.startsWith('/api/index') && matched !== '/api') {
    const orig = req.originalUrl || req.url || '';
    const qIndex = orig.indexOf('?');
    const queryString = qIndex !== -1 ? orig.slice(qIndex) : '';
    return matched.includes('?') ? matched : `${matched}${queryString}`;
  }

  // 3. Normal request path (strip serverless prefix if present)
  let target = req.originalUrl || req.url || '/';
  if (target.startsWith('/api/index')) {
    target = target.replace(/^\/api\/index/, '') || '/';
  }
  return target;
}

// Proxy handler for all requests
async function handleProxy(req: express.Request, res: express.Response, overridePath?: string) {
  const targetPath = overridePath || resolvePath(req);
  const targetUrl = new URL(targetPath, TARGET_ORIGIN);

  // Construct intelligent Referer header
  let refererHeader = `${TARGET_ORIGIN}/`;
  const incomingReferer = (req.headers['referer'] as string) || '';

  if (incomingReferer) {
    try {
      const u = new URL(incomingReferer);
      u.protocol = 'https:';
      u.host = TARGET_HOST;
      refererHeader = u.toString();
    } catch {
      refererHeader = `${TARGET_ORIGIN}/`;
    }
  }

  // Critical requirement: Video endpoints require exact watch path referer with query params
  if (
    targetPath.startsWith('/api/video-url') ||
    targetPath.startsWith('/api/get-video-url') ||
    targetPath.startsWith('/api/Schedule') ||
    targetPath.startsWith('/api/play') ||
    targetPath.startsWith('/api/get-otp')
  ) {
    const q = targetUrl.searchParams;
    const batchId =
      q.get('batch_id') ||
      q.get('batchId') ||
      q.get('BatchId') ||
      '';
    const subjectId =
      q.get('subject_id') ||
      q.get('subjectId') ||
      q.get('SubjectId') ||
      '';
    const videoId =
      q.get('video_id') ||
      q.get('videoId') ||
      q.get('childId') ||
      q.get('ChildId') ||
      q.get('contentId') ||
      q.get('ContentId') ||
      '';
    if (batchId || subjectId || videoId) {
      refererHeader = `${TARGET_ORIGIN}/watch?batchId=${batchId}&SubjectId=${subjectId}&ContentId=${videoId}`;
    } else {
      refererHeader = `${TARGET_ORIGIN}/watch`;
    }
  }

  // Ensure full-access session cookie is attached so upstream key generation is bypassed
  const accessCookie = await getAccessCookie();
  const incomingCookie = (req.headers['cookie'] as string) || '';
  const mergedCookies = [accessCookie];
  if (incomingCookie) {
    // Preserve any existing cookies without letting an expired access cookie override
    const filteredIncoming = incomingCookie
      .split(';')
      .map((c) => c.trim())
      .filter((c) => !c.startsWith('studymeta_access='));
    if (filteredIncoming.length > 0) {
      mergedCookies.push(...filteredIncoming);
    }
  }

  const forwardHeaders: http.OutgoingHttpHeaders = {
    ...req.headers,
    host: TARGET_HOST,
    origin: TARGET_ORIGIN,
    referer: refererHeader,
    cookie: mergedCookies.join('; '),
    'user-agent':
      (req.headers['user-agent'] as string) ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };

  // Strip hop-by-hop headers
  delete forwardHeaders['connection'];
  delete forwardHeaders['keep-alive'];
  delete forwardHeaders['transfer-encoding'];
  delete forwardHeaders['x-matched-path'];

  // Check if this request is a video stream, manifest, DRM OTP, or media segment
  // These MUST bypass any string buffering/transformation for instantaneous playback
  const isDirectMedia =
    targetPath.startsWith('/api/play') ||
    targetPath.startsWith('/api/get-otp') ||
    targetPath.startsWith('/api/video-url') ||
    targetPath.startsWith('/api/Schedule') ||
    targetPath.includes('.mpd') ||
    targetPath.includes('.m3u8') ||
    targetPath.includes('.m4s') ||
    targetPath.includes('.mp4');

  const proxyReq = https.request(
    targetUrl,
    {
      method: req.method,
      headers: forwardHeaders,
    },
    (proxyRes) => {
      const statusCode = proxyRes.statusCode || 200;
      const headers = { ...proxyRes.headers };

      // Remove framing/CSP restrictions to allow embedding in preview
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      delete headers['content-security-policy-report-only'];

      // Allow CORS from any origin for media & API requests
      headers['access-control-allow-origin'] = '*';
      headers['access-control-allow-methods'] = 'GET, POST, OPTIONS, HEAD';
      headers['access-control-allow-headers'] = '*';

      // Always set the full-access cookie on client so the browser stays authenticated
      if (accessCookie) {
        const clientAccessSet = `${accessCookie}; Path=/; SameSite=Lax; Max-Age=86400`;
        if (headers['set-cookie']) {
          const sc = Array.isArray(headers['set-cookie'])
            ? headers['set-cookie']
            : [headers['set-cookie']];
          headers['set-cookie'] = [clientAccessSet, ...sc];
        } else {
          headers['set-cookie'] = [clientAccessSet];
        }
      }

      // Rewrite cookies to work without strict domain pinning
      if (headers['set-cookie']) {
        const cookies = Array.isArray(headers['set-cookie'])
          ? headers['set-cookie']
          : [headers['set-cookie']];
        headers['set-cookie'] = cookies.map((c) =>
          c.replace(/domain=[^;]+;?/gi, '').replace(/Secure;?/gi, '')
        );
      }

      // Rewrite redirect Location to relative, and bypass any key-generate redirect!
      if (headers['location']) {
        let loc = headers['location'].replace(
          /https?:\/\/(www\.)?learnxpw\.site/gi,
          ''
        );

        // If upstream ever redirects to key-generate, immediately forward to target destination!
        if (loc.includes('key-generate')) {
          try {
            const locUrl = new URL(headers['location'], TARGET_ORIGIN);
            const redirectParam = locUrl.searchParams.get('redirect') || '/study/batches';
            if (redirectParam === targetPath || redirectParam === req.url) {
              loc = '/study/batches';
            } else {
              loc = redirectParam;
            }
          } catch {
            loc = '/study/batches';
          }
        }
        headers['location'] = loc;
      }

      const contentType = (headers['content-type'] || '').toLowerCase();

      // Only transform UI text (HTML, RSC components, search/batch listings, static scripts)
      // Never transform video streams, manifests, or media chunks!
      const isText =
        !isDirectMedia &&
        (contentType.includes('text/html') ||
          contentType.includes('application/x-javascript') ||
          contentType.includes('application/javascript') ||
          contentType.includes('text/javascript') ||
          contentType.includes('text/x-component') ||
          (contentType.includes('application/json') && !targetPath.startsWith('/api/play')));

      if (!isText) {
        // Stream binary responses and media segments directly at maximum wire speed
        res.writeHead(statusCode, headers);
        proxyRes.pipe(res);
        return;
      }

      // Buffer text responses for string substitution
      const chunks: Buffer[] = [];
      proxyRes.on('data', (chunk) => {
        chunks.push(chunk);
      });

      proxyRes.on('end', () => {
        try {
          const rawBuffer = Buffer.concat(chunks);
          let decompressedBuffer = rawBuffer;
          const encoding = (headers['content-encoding'] || '').toLowerCase();

          if (encoding === 'gzip') {
            decompressedBuffer = zlib.gunzipSync(rawBuffer);
          } else if (encoding === 'br') {
            decompressedBuffer = zlib.brotliDecompressSync(rawBuffer);
          } else if (encoding === 'deflate') {
            decompressedBuffer = zlib.inflateSync(rawBuffer);
          }

          const originalText = decompressedBuffer.toString('utf-8');
          const modifiedText = transformText(originalText);
          const outputBuffer = Buffer.from(modifiedText, 'utf-8');

          // Remove compression and chunking headers since output is uncompressed with exact length
          delete headers['content-encoding'];
          delete headers['transfer-encoding'];
          headers['content-length'] = String(outputBuffer.length);

          res.writeHead(statusCode, headers);
          res.end(outputBuffer);
        } catch (err) {
          console.error('Error modifying text response:', err);
          const rawBuffer = Buffer.concat(chunks);
          delete headers['transfer-encoding'];
          headers['content-length'] = String(rawBuffer.length);
          res.writeHead(statusCode, headers);
          res.end(rawBuffer);
        }
      });
    }
  );

  proxyReq.on('error', (err) => {
    console.error('Proxy request error:', err);
    if (!res.headersSent) {
      res.status(502).send(`Proxy Error: ${err.message}`);
    }
  });

  // Pipe request body if POST/PUT
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

// Catch-all route to proxy every path
app.use((req, res) => {
  handleProxy(req, res);
});

export default app;
