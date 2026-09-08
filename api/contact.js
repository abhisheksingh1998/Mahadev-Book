const nodemailer = require('nodemailer');

const MAIL_TO = 'navneetsingh@inkspilled.in';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SHORT = 120;
const MAX_MESSAGE = 4000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map();

function clip(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

function originAllowed(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (host === 'mahadev-chi.vercel.app') return true;
    if (host.endsWith('.vercel.app') && host.startsWith('mahadev-')) return true;
    const self = process.env.VERCEL_URL ? new URL('https://' + process.env.VERCEL_URL).hostname : '';
    return Boolean(self && host === self);
  } catch {
    return false;
  }
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  const raw = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : '';
  if (raw) {
    try {
      return Promise.resolve(JSON.parse(raw));
    } catch {
      return Promise.resolve({});
    }
  }
  return new Promise(function (resolve) {
    const chunks = [];
    req.on('data', function (c) {
      chunks.push(c);
    });
    req.on('end', function () {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve({});
      }
    });
    req.on('error', function () {
      resolve({});
    });
  });
}

function requestOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  if (origin) return origin;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  }
  return 'https://mahadev-chi.vercel.app';
}

async function sendWithSmtp(fields) {
  const pass = process.env.SMTP_PASS;
  if (!pass) return false;
  const user = process.env.SMTP_USER || MAIL_TO;
  const { text, html } = emailBodies(fields);
  try {
    await nodemailer
      .createTransport({
        host: process.env.SMTP_HOST || 'smtp.office365.com',
        port: Number(process.env.SMTP_PORT || 587),
        secure: false,
        requireTLS: true,
        auth: { user, pass },
      })
      .sendMail({
        from: '"Inkspilled website" <' + user + '>',
        to: MAIL_TO,
        replyTo: fields.name + ' <' + fields.email + '>',
        subject: 'New inquiry from ' + fields.name,
        text,
        html,
      });
    return true;
  } catch (err) {
    console.error('SMTP failed:', err && err.code ? err.code : 'SEND');
    return false;
  }
}

async function sendToMailbox(fields, origin) {
  try {
    const response = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(MAIL_TO), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: origin,
        Referer: origin.replace(/\/$/, '') + '/',
      },
      body: JSON.stringify({
        name: fields.name,
        email: fields.email,
        phone: fields.phone,
        service: fields.service,
        message: fields.message,
        _subject: 'New inquiry from ' + fields.name + ', Inkspilled',
        _template: 'table',
        _captcha: 'false',
        _replyto: fields.email,
      }),
    });
    const data = await response.json().catch(function () {
      return null;
    });
    if (data && (data.success === true || data.success === 'true')) return true;
    return String(data && data.message ? data.message : '')
      .toLowerCase()
      .includes('activation');
  } catch (err) {
    console.error('Mailbox delivery failed');
    return false;
  }
}

function emailBodies(fields) {
  const rows = [
    ['Name', fields.name],
    ['Email', fields.email],
    ['Phone', fields.phone || '—'],
    ['Service', fields.service || '—'],
    ['Message', fields.message || '—'],
  ];
  const text = rows.map(([label, value]) => label + ': ' + value).join('\n');
  const htmlRows = rows
    .map(
      ([label, value]) =>
        '<tr><td style="padding:10px 12px;border-bottom:1px solid #ececec;color:#666;width:140px;vertical-align:top;">' +
        escapeHtml(label) +
        '</td><td style="padding:10px 12px;border-bottom:1px solid #ececec;color:#1a1a1a;white-space:pre-wrap;">' +
        escapeHtml(value) +
        '</td></tr>'
    )
    .join('');
  const html =
    '<div style="font-family:Arial,sans-serif;background:#f6f6f4;padding:24px;">' +
    '<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #ececec;border-radius:12px;overflow:hidden;">' +
    '<div style="padding:20px 24px;background:#1a1a1a;color:#fff;">' +
    '<p style="margin:0;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#bbb;">Inkspilled</p>' +
    '<h1 style="margin:8px 0 0;font-size:22px;">New website inquiry</h1>' +
    '</div>' +
    '<table style="width:100%;border-collapse:collapse;">' +
    htmlRows +
    '</table></div></div>';
  return { text, html };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }
  if (!originAllowed(req)) {
    json(res, 403, { ok: false, error: 'Could not send. Please try again.' });
    return;
  }
  if (rateLimited(clientIp(req))) {
    json(res, 429, { ok: false, error: 'Please wait a few minutes before sending another request.' });
    return;
  }

  const body = await parseBody(req);
  if (clip(body.website, MAX_SHORT) || clip(body._gotcha, MAX_SHORT)) {
    json(res, 200, { ok: true });
    return;
  }

  const name = clip(body.name, MAX_SHORT);
  const email = clip(body.email, MAX_SHORT);
  const phone = clip(body.phone, MAX_SHORT);
  const service = clip(body.service, MAX_SHORT);
  const message = clip(body.message, MAX_MESSAGE);

  if (!name) {
    json(res, 400, { ok: false, error: 'Add your name.' });
    return;
  }
  if (!EMAIL_RE.test(email)) {
    json(res, 400, { ok: false, error: 'Add a valid email.' });
    return;
  }

  const fields = { name, email, phone, service, message };
  const delivered =
    (await sendWithSmtp(fields)) || (await sendToMailbox(fields, requestOrigin(req)));

  if (!delivered) {
    json(res, 500, { ok: false, error: 'Could not send. Please try again in a moment.' });
    return;
  }

  json(res, 200, { ok: true });
};
