// api/lead.js — Vercel Serverless Function.
// Принимает заявку с формы сайта (POST /api/lead, JSON) и отправляет её
// сообщением в ваш Telegram через бота. Видите заявки только вы:
// токен бота и ваш chat_id лежат в переменных окружения Vercel,
// в коде и на сайте их нет.
//
// Переменные окружения (Vercel → Project → Settings → Environment Variables):
//   TELEGRAM_BOT_TOKEN — токен от @BotFather
//   TELEGRAM_CHAT_ID   — ваш chat_id (число)

const WINDOW_MS = 10 * 60 * 1000; // окно для защиты от спама
const MAX_PER_WINDOW = 5;         // заявок с одного IP за окно
const hits = new Map();           // в памяти функции; этого достаточно против простых ботов

function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > MAX_PER_WINDOW;
}

const s = v => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
const esc = v => s(v).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'method_not_allowed' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    res.statusCode = 503; // сайт покажет «приём заявок ещё не настроен»
    return res.json({ ok: false, error: 'not_configured' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object') {
    res.statusCode = 400;
    return res.json({ ok: false, error: 'bad_json' });
  }

  // Поле-ловушка: люди его не видят и не заполняют, боты заполняют.
  if (s(body.website)) return res.json({ ok: true });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooMany(ip)) {
    res.statusCode = 429;
    return res.json({ ok: false, error: 'too_many' });
  }

  const name = s(body.name);
  const phone = s(body.phone);
  if (!name || phone.replace(/\D/g, '').length < 10) {
    res.statusCode = 400;
    return res.json({ ok: false, error: 'validation' });
  }

  const when = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const text = [
    '🆕 <b>Заявка с сайта «Форма»</b>',
    `👤 ${esc(name)}`,
    `📞 ${esc(phone)}`,
    body.model ? `🪵 ${esc(body.model)} — ${esc(body.pricePerM2)} ₽/м²` : '',
    body.width ? `📐 ${esc(body.width)} × ${esc(body.height)} м, проёмы ${esc(body.openings)} м² → ${esc(body.area)} м², ${esc(body.sheets)} листов` : '',
    body.totalText ? `💰 ${esc(body.totalText)} · ${body.install ? 'с монтажом' : 'без монтажа'} · ${esc(body.delivery)}` : '',
    body.comment ? `💬 ${esc(body.comment)}` : '',
    `🕒 ${when} (МСК)`,
  ].filter(Boolean).join('\n');

  const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });

  if (!tg.ok) {
    res.statusCode = 502;
    return res.json({ ok: false, error: 'telegram_failed' });
  }
  return res.json({ ok: true });
};
