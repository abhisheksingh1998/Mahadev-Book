const nodemailer = require('nodemailer');

const MAIL_TO = 'navneetsingh@inkspilled.in';
const SITE_URL = 'https://www.inkspilled.com/';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SHORT = 120;
const MAX_MESSAGE = 4000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 20;
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
  return forwarded || (req.socket && req.socket.remoteAddress) || 'unknown';
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
    if (host === 'inkspilled.com' || host === 'www.inkspilled.com') return true;
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

function mailMessage(fields) {
  const fromName = String(fields.name).replace(/"/g, '');
  const { text, html } = emailBodies(fields);
  return {
    from: '"Inkspilled" <' + MAIL_TO + '>',
    to: MAIL_TO,
    replyTo: '"' + fromName + '" <' + fields.email + '>',
    subject: 'New Inkspilled form submission from ' + fields.name,
    text,
    html,
    headers: {
      'X-Mailer': 'Inkspilled',
      'Message-ID': '<' + Date.now() + '.' + Math.random().toString(36).slice(2) + '@inkspilled.in>',
    },
    envelope: { from: MAIL_TO, to: MAIL_TO },
  };
}

function emailBodies(fields) {
  const rows = [
    ['Name', fields.name],
    ['Email', fields.email],
    ['Phone', fields.phone || '—'],
    ['Service', fields.service || '—'],
    ['Message', fields.message || '—'],
  ];
  const text = [
    'Someone just submitted your form on ' + SITE_URL,
    '',
    rows.map(function (row) {
      return row[0] + ': ' + row[1];
    }).join('\n'),
    '',
    'Reply directly to this email to contact the sender.',
    'Inkspilled · Delhi · Dubai · ' + SITE_URL,
  ].join('\n');

  const htmlRows = rows
    .map(function (row) {
      return (
        '<tr>' +
        '<td style="padding:12px 16px;border-bottom:1px solid #ececec;color:#6a6a72;font-size:13px;width:140px;vertical-align:top;">' +
        escapeHtml(row[0]) +
        '</td>' +
        '<td style="padding:12px 16px;border-bottom:1px solid #ececec;color:#12121a;font-size:14px;white-space:pre-wrap;">' +
        escapeHtml(row[1]) +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  const html =
    '<div style="margin:0;padding:24px;background:#f5f2ea;font-family:Arial,Helvetica,sans-serif;">' +
    '<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #ececec;border-radius:16px;overflow:hidden;">' +
    '<div style="height:6px;background:linear-gradient(90deg,#e8352b 0 33%,#4ea63a 33% 66%,#1a86d8 66% 100%);"></div>' +
    '<div style="padding:24px 28px 8px;">' +
    '<p style="margin:0;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#6a6a72;">Inkspilled</p>' +
    '<h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;color:#12121a;">New form submission</h1>' +
    '<p style="margin:12px 0 0;font-size:15px;line-height:1.55;color:#12121a;">Someone just submitted your form on <a href="' +
    SITE_URL +
    '" style="color:#1a86d8;text-decoration:none;">' +
    SITE_URL +
    '</a></p>' +
    '</div>' +
    '<table style="width:100%;border-collapse:collapse;margin-top:8px;">' +
    htmlRows +
    '</table>' +
    '<div style="padding:18px 28px 24px;color:#6a6a72;font-size:13px;line-height:1.5;">' +
    '<p style="margin:0;">Reply directly to this email to reach the sender.</p>' +
    '<p style="margin:10px 0 0;">Inkspilled · Delhi · Dubai<br><a href="' +
    SITE_URL +
    '" style="color:#1a86d8;text-decoration:none;">' +
    SITE_URL.replace(/\/$/, '') +
    '</a></p>' +
    '</div></div></div>';

  return { text, html };
}

async function sendWithSmtp(fields) {
  const pass = process.env.SMTP_PASS;
  if (!pass) return false;
  const user = process.env.SMTP_USER || MAIL_TO;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = port === 465;
  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.office365.com',
      port: port,
      secure: secure,
      requireTLS: !secure,
      tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
      auth: { user: user, pass: pass },
    });
    const message = mailMessage(fields);
    message.from = '"Inkspilled" <' + user + '>';
    message.envelope = { from: user, to: MAIL_TO };
    await transport.sendMail(message);
    return true;
  } catch (err) {
    console.error('SMTP failed:', err && err.code ? err.code : 'SEND');
    return false;
  }
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

  const fields = { name: name, email: email, phone: phone, service: service, message: message };
  const delivered = await sendWithSmtp(fields);

  if (!delivered) {
    json(res, 500, { ok: false, error: 'Could not send. Please try again in a moment.' });
    return;
  }

  json(res, 200, { ok: true });
};
