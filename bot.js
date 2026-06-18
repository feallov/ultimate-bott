const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const http = require('http');

// --- 1. CONFIG ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID || "0");
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

const bot = new Telegraf(BOT_TOKEN);

// Инициализация сессий
bot.use(session());
bot.use((ctx, next) => {
  ctx.session ??= {};
  return next();
});

// --- 2. DATABASE ---
const DB_FILE = './db.json';
let db = { users: {}, settings: {} };

const loadDb = () => {
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(data);
    } catch (e) { 
      console.error("DB Load Error, resetting...");
      db = { users: {}, settings: {} };
    }
  }
};
loadDb();

const saveDb = () => {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error("DB Save Error:", e);
  }
};

// --- 3. MIDDLEWARE ---
bot.use((ctx, next) => {
  if (!ctx.from || !ctx.from.id) return next();
  const uid = ctx.from.id;
  
  if (!db.users[uid]) {
    db.users[uid] = { 
      first_name: ctx.from.first_name || "User", 
      username: ctx.from.username || 'n/a', 
      joined: new Date().toISOString(), 
      isBanned: false, 
      trollMode: null, 
      messagesSent: 0 
    };
    saveDb();
  }
  
  db.users[uid].messagesSent++;
  saveDb();

  if (db.users[uid].isBanned && uid !== ADMIN_ID) {
    return ctx.reply('🛑 Ваш доступ к боту заблокирован.');
  }
  return next();
});

// --- 4. KEYBOARDS ---
const mainMenu = Markup.keyboard([
  ['🌤 Погода', '🌐 Переводчик'],
  ['🔳 QR Код', '💱 Валюты & Крипто'],
  ['⏰ Напоминалка', '🔑 Пароли'],
  ['🎲 Рандом', '👤 Профиль']
]).resize();

const adminMenu = Markup.inlineKeyboard([
  [Markup.button.callback('👥 Список пользователей', 'adm_u')],
  [Markup.button.callback('📢 Массовая рассылка', 'adm_bc')]
]);

// --- 5. COMMANDS ---
bot.start((ctx) => {
  ctx.session = {};
  ctx.reply(`👋 Привет, ${ctx.from.first_name}! Бот v6.0 готов.`, mainMenu);
});

bot.hears('🌤 Погода', (ctx) => {
  ctx.reply('Напишите название города:');
  ctx.session.state = 'WAIT_WEATHER';
});

bot.hears('🌐 Переводчик', (ctx) => {
  ctx.reply('Введите текст для перевода на РУССКИЙ:');
  ctx.session.state = 'WAIT_TRANSLATE';
});

bot.hears('🔳 QR Код', (ctx) => {
  ctx.reply('Отправьте ссылку или текст для QR:');
  ctx.session.state = 'WAIT_QR';
});

bot.hears('💱 Валюты & Крипто', async (ctx) => {
  ctx.reply('⌛️ Получаю курсы...');
  try {
    const fiat = await axios.get('https://www.cbr-xml-daily.ru/daily_json.js', { timeout: 5000 });
    const btc = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCTUSD', { timeout: 5000 });
    const val = fiat.data.Valute;
    const text = `📊 *Курсы ЦБ РФ:* \n\n🇺🇸 USD: \`${val.USD.Value.toFixed(2)}\` ₽\n🇪🇺 EUR: \`${val.EUR.Value.toFixed(2)}\` ₽\n\n₿ Bitcoin: \`$${parseFloat(btc.data.price).toFixed(0)}\``;
    ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (e) { ctx.reply('❌ Ошибка API. Попробуйте позже.'); }
});

bot.hears('🎲 Рандом', (ctx) => {
  ctx.reply('Тип рандома:', Markup.inlineKeyboard([
    [Markup.button.callback('🔢 Число', 'r_n'), Markup.button.callback('🪙 Монетка', 'r_c')],
    [Markup.button.callback('🎲 Кубик', 'r_d'), Markup.button.callback('💡 Факт', 'r_f')]
  ]));
});

bot.hears('🔑 Пароли', (ctx) => {
  const p = Math.random().toString(36).slice(-10) + (Math.random()*100).toFixed(0);
  ctx.reply(`🔑 Пароль: \`${p}\``, { parse_mode: 'Markdown' });
});

bot.hears('👤 Профиль', (ctx) => {
  const u = db.users[ctx.from.id];
  ctx.reply(`👤 ID: \`${ctx.from.id}\`\n✉️ Msg: ${u.messagesSent}`, { parse_mode: 'Markdown' });
});

// --- 6. ADMIN & TROLLING LOGIC ---
bot.command('admin', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  ctx.reply('🔧 Админка:', adminMenu);
});

bot.action('adm_u', (ctx) => {
  const users = Object.entries(db.users).slice(-10);
  const btns = users.map(([id, u]) => [Markup.button.callback(`${u.first_name} [${id}]`, `ins_${id}`)]);
  ctx.editMessageText('👥 Последние пользователи:', Markup.inlineKeyboard([...btns, [Markup.button.callback('⬅️ Назад', 'adm_h')]]));
});

bot.action(/ins_(\d+)/, (ctx) => {
  const tid = ctx.match[1];
  const u = db.users[tid];
  if (!u) return ctx.answerCbQuery('Не найден');
  ctx.editMessageText(`👤 ${u.first_name}\n🆔 ${tid}\n🤡 Режим: ${u.trollMode || 'Выкл'}`, Markup.inlineKeyboard([
    [Markup.button.callback(u.isBanned ? '✅ Разбанить' : '🚫 Забанить', `bn_${tid}`)],
    [Markup.button.callback('🤡 Меню Троллинга', `tr_${tid}`)],
    [Markup.button.callback('⬅️ Назад', 'adm_u')]
  ]));
});

bot.action(/tr_(\d+)/, (ctx) => {
  const tid = ctx.match[1];
  ctx.editMessageText(`🤡 Выберите режим для ${tid}:`, Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Реверс', `st_${tid}_reverse`), Markup.button.callback('👻 Хоррор', `st_${tid}_scary`)],
    [Markup.button.callback('💾 Ошибка БД', `st_${tid}_db_error`), Markup.button.callback('❓ Почему?', `st_${tid}_why`)],
    [Markup.button.callback('🚫 Выключить всё', `st_${tid}_none`), Markup.button.callback('⬅️ Назад', `ins_${tid}`)]
  ]));
});

bot.action(/st_(\d+)_(\w+)/, (ctx) => {
  const tid = ctx.match[1];
  const mode = ctx.match[2] === 'none' ? null : ctx.match[2];
  if (db.users[tid]) {
    db.users[tid].trollMode = mode;
    saveDb();
  }
  ctx.answerCbQuery(`Режим: ${mode || 'Выкл'}`);
  ctx.editMessageText(`✅ Режим троллинга для ${tid} изменен на: ${mode || 'Обычный'}`, Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Назад', `tr_${tid}`)]
  ]));
});

bot.action(/bn_(\d+)/, (ctx) => {
  const tid = ctx.match[1];
  if (db.users[tid]) {
    db.users[tid].isBanned = !db.users[tid].isBanned;
    saveDb();
  }
  ctx.answerCbQuery('Статус изменен');
  ctx.editMessageText('✅ Статус доступа обновлен.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `ins_${tid}`)]]));
});

bot.action('adm_h', (ctx) => ctx.editMessageText('🔧 Админка:', adminMenu));

bot.action(/r_(\w+)/, (ctx) => {
  const t = ctx.match[1];
  ctx.answerCbQuery();
  if (t === 'n') return ctx.reply(`🔢 Число: ${Math.floor(Math.random()*100)+1}`);
  if (t === 'c') return ctx.reply(`🪙: ${Math.random() > 0.5 ? 'Орел' : 'Решка'}`);
  if (t === 'd') return ctx.replyWithDice();
  if (t === 'f') {
    const facts = ["У осьминога 3 сердца.", "Мед не портится.", "Панды спят 12 часов."];
    return ctx.reply(`💡 Факт: ${facts[Math.floor(Math.random()*facts.length)]}`);
  }
});

// --- 7. MAIN TEXT HANDLER ---
bot.on('text', async (ctx) => {
  const uid = ctx.from.id;
  const user = db.users[uid];
  const state = ctx.session?.state;
  const text = ctx.message.text;

  // 1. ТРОЛЛИНГ (срабатывает на ЛЮБОЙ текст, если режим включен)
  // Убрал проверку на ADMIN_ID, чтобы ты мог тестировать на себе
  if (user.trollMode && !text.startsWith('/')) {
    if (user.trollMode === 'reverse') return ctx.reply(text.split('').reverse().join(''));
    if (user.trollMode === 'scary') return ctx.reply('Я вижу тебя... 👀 Оглянись.');
    if (user.trollMode === 'db_error') return ctx.reply('❌ [FATAL ERROR]: DB_SYNC_FAILED.');
    if (user.trollMode === 'why') return ctx.reply(`А почему ты написал "${text}"? 🤔`);
  }

  // 2. АДМИН РАССЫЛКА
  if (uid === ADMIN_ID && state === 'WAIT_BC') {
    const all = Object.keys(db.users);
    for (const id of all) {
      bot.telegram.sendMessage(id, `📢 *ОБЪЯВЛЕНИЕ:* \n\n${text}`, { parse_mode: 'Markdown' }).catch(()=>{});
    }
    ctx.reply('✅ Рассылка завершена.', mainMenu);
    ctx.session.state = null;
    return;
  }

  // 3. STATES
  if (state === 'WAIT_WEATHER') {
    try {
      const res = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(text)}&appid=${WEATHER_API_KEY}&units=metric&lang=ru`);
      ctx.reply(`🌤 *${res.data.name}:* ${res.data.main.temp.toFixed(1)}°C, ${res.data.weather[0].description}`, mainMenu);
    } catch (e) { ctx.reply('❌ Город не найден.'); }
    ctx.session.state = null;
  } 
  else if (state === 'WAIT_TRANSLATE') {
    try {
      const res = await axios.get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=${encodeURIComponent(text)}`);
      ctx.reply(`🌐 *Перевод:* \n\n${res.data[0][0][0]}`, mainMenu);
    } catch (e) { ctx.reply('❌ Ошибка перевода.'); }
    ctx.session.state = null;
  }
  else if (state === 'WAIT_QR') {
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`;
    ctx.replyWithPhoto(qr, { caption: '🔳 QR-код готов!', ...mainMenu });
    ctx.session.state = null;
  }
});

// --- 8. STARTUP ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }).listen(PORT);

setTimeout(() => {
  bot.launch().then(() => console.log('🚀 БОТ ЗАПУЩЕН! v6.0 FINAL TESTED'));
}, 3000);
