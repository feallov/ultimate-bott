const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const http = require('http');

// --- 1. CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID || "0");
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

if (!BOT_TOKEN) {
  console.error("FATAL: BOT_TOKEN is missing!");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Инициализация сессий с гарантированным объектом
bot.use(session());
bot.use((ctx, next) => {
  ctx.session ??= {};
  return next();
});

// --- 2. DATABASE ---
const DB_FILE = './db.json';
let db = { users: {}, settings: { maintenance: false } };
const loadDb = () => {
  if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE)); } catch (e) { db = { users: {}, settings: {} }; }
  }
};
loadDb();
const saveDb = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

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

// --- 5. COMMANDS & HEARS ---
bot.start((ctx) => {
  ctx.session = {};
  ctx.reply(`👋 Привет, ${ctx.from.first_name}! Бот v5.5 (10x Verified) запущен.`, mainMenu);
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
  ctx.reply('Отправьте текст или ссылку для генерации QR:');
  ctx.session.state = 'WAIT_QR';
});

bot.hears('💱 Валюты & Крипто', async (ctx) => {
  ctx.reply('⌛️ Опрашиваю финансовые шлюзы...');
  try {
    const [fiat, btc] = await Promise.all([
      axios.get('https://www.cbr-xml-daily.ru/daily_json.js', { timeout: 5000 }),
      axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCTUSD', { timeout: 5000 })
    ]);
    const val = fiat.data.Valute;
    const text = `📊 *Курсы ЦБ РФ:* \n\n🇺🇸 USD: \`${val.USD.Value.toFixed(2)}\` ₽\n🇪🇺 EUR: \`${val.EUR.Value.toFixed(2)}\` ₽\n🇨🇳 CNY: \`${val.CNY.Value.toFixed(2)}\` ₽\n\n₿ Bitcoin: \`$${parseFloat(btc.data.price).toFixed(0)}\``;
    ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (e) { ctx.reply('❌ Ошибка связи с API бирж. Повторите позже.'); }
});

bot.hears('🎲 Рандом', (ctx) => {
  ctx.reply('Что выберем?', Markup.inlineKeyboard([
    [Markup.button.callback('🔢 Число', 'r_n'), Markup.button.callback('🪙 Монетка', 'r_c')],
    [Markup.button.callback('🎲 Кубик', 'r_d'), Markup.button.callback('💡 Факт', 'r_f')]
  ]));
});

bot.hears('🔑 Пароли', (ctx) => {
  const p = Math.random().toString(36).slice(-8) + (Math.random()*100).toFixed(0);
  ctx.reply(`🔑 Сгенерирован временный пароль:\n\`${p}\``, { parse_mode: 'Markdown' });
});

bot.hears('👤 Профиль', (ctx) => {
  const u = db.users[ctx.from.id];
  ctx.reply(`👤 *Ваш профиль:*\n🆔 ID: \`${ctx.from.id}\`\n✉️ Сообщений: ${u.messagesSent}\n📅 С нами с: ${new Date(u.joined).toLocaleDateString()}`, { parse_mode: 'Markdown' });
});

// --- 6. ACTIONS (Inline Buttons) ---
bot.action(/r_(\w+)/, (ctx) => {
  try {
    const t = ctx.match[1];
    ctx.answerCbQuery();
    if (t === 'n') return ctx.reply(`🔢 Число: ${Math.floor(Math.random()*100)+1}`);
    if (t === 'c') return ctx.reply(`🪙 Результат: ${Math.random() > 0.5 ? 'Орел' : 'Решка'}`);
    if (t === 'd') return ctx.replyWithDice();
    if (t === 'f') {
      const facts = ["У осьминога 3 сердца.", "Мед не портится никогда.", "Панды спят 12 часов в день.", "Земля не идеальный шар."];
      return ctx.reply(`💡 Факт: ${facts[Math.floor(Math.random()*facts.length)]}`);
    }
  } catch (e) { console.error(e); }
});

// --- 7. ADMIN & TROLLING ---
bot.command('admin', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  ctx.reply('🔧 Панель управления проектом:', adminMenu);
});

bot.action('adm_bc', (ctx) => {
  ctx.reply('📢 Введите текст сообщения для всех пользователей:');
  ctx.session.state = 'WAIT_BC';
  ctx.answerCbQuery();
});

bot.action('adm_u', (ctx) => {
  const users = Object.entries(db.users).slice(-10);
  const btns = users.map(([id, u]) => [Markup.button.callback(`${u.first_name || 'User'} [${id}]`, `ins_${id}`)]);
  ctx.editMessageText('👥 Последние активности:', Markup.inlineKeyboard([...btns, [Markup.button.callback('⬅️ Назад', 'adm_h')]]));
});

bot.action(/ins_(\d+)/, (ctx) => {
  const tid = ctx.match[1];
  const u = db.users[tid];
  if (!u) return ctx.answerCbQuery('Юзер не найден');
  ctx.editMessageText(`👤 ${u.first_name}\n🆔 ${tid}\n🤡 Режим: ${u.trollMode || 'Выкл'}`, Markup.inlineKeyboard([
    [Markup.button.callback(u.isBanned ? '✅ Разбанить' : '🚫 Забанить', `bn_${tid}`)],
    [Markup.button.callback('🤡 Троллинг', `tr_${tid}`)],
    [Markup.button.callback('⬅️ Назад', 'adm_u')]
  ]));
});

bot.action(/tr_(\d+)/, (ctx) => {
  const tid = ctx.match[1];
  ctx.editMessageText(`🤡 Режим для ${tid}:`, Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Реверс', `st_${tid}_reverse`), Markup.button.callback('👻 Хоррор', `st_${tid}_scary`)],
    [Markup.button.callback('💾 Ошибка', `st_${tid}_db_error`), Markup.button.callback('❓ Почему?', `st_${tid}_why`)],
    [Markup.button.callback('🚫 Выкл', `st_${tid}_none`), Markup.button.callback('⬅️ Назад', `ins_${tid}`)]
  ]));
});

bot.action(/st_(\d+)_(\w+)/, (ctx) => {
  const tid = ctx.match[1];
  if (db.users[tid]) db.users[tid].trollMode = ctx.match[2] === 'none' ? null : ctx.match[2];
  saveDb();
  ctx.answerCbQuery('Обновлено');
  ctx.editMessageText('✅ Настройки троллинга сохранены.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `ins_${tid}`)]]));
});

bot.action(/bn_(\d+)/, (ctx) => {
  const tid = ctx.match[1];
  if (db.users[tid]) db.users[tid].isBanned = !db.users[tid].isBanned;
  saveDb();
  ctx.editMessageText('✅ Статус доступа изменен.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `ins_${tid}`)]]));
});

bot.action('adm_h', (ctx) => ctx.editMessageText('🔧 Панель управления:', adminMenu));

// --- 8. MAIN HANDLER ---
bot.on('text', async (ctx) => {
  const uid = ctx.from.id;
  const user = db.users[uid];
  const state = ctx.session?.state;
  const text = ctx.message.text;

  // Игнорируем команды для троллинга
  const isCommand = text.startsWith('/');

  // TROLLING (Только если не админ и не команда)
  if (user.trollMode && uid !== ADMIN_ID && !isCommand) {
    if (user.trollMode === 'reverse') return ctx.reply(text.split('').reverse().join(''));
    if (user.trollMode === 'scary') return ctx.reply(['Кто за тобой стоит? 👁', 'Оглянись.', 'Я всё вижу.'].sort(() => 0.5-Math.random())[0]);
    if (user.trollMode === 'db_error') return ctx.reply('❌ [FATAL ERROR]: 0x8004210B Database Sync Failed.');
    if (user.trollMode === 'why') return ctx.reply(`А почему ты написал именно "${text}"?`);
  }

  // STATES
  if (state === 'WAIT_WEATHER') {
    try {
      const res = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(text)}&appid=${WEATHER_API_KEY}&units=metric&lang=ru`);
      ctx.reply(`🌤 *${res.data.name}:* ${res.data.main.temp.toFixed(1)}°C, ${res.data.weather[0].description}`, mainMenu);
    } catch (e) { ctx.reply('❌ Город не найден или ошибка API.', mainMenu); }
    ctx.session.state = null;
  } 
  else if (state === 'WAIT_TRANSLATE') {
    try {
      const res = await axios.get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=${encodeURIComponent(text)}`);
      ctx.reply(`🌐 *Перевод на русский:* \n\n${res.data[0][0][0]}`, { parse_mode: 'Markdown', ...mainMenu });
    } catch (e) { ctx.reply('❌ Ошибка переводчика.', mainMenu); }
    ctx.session.state = null;
  }
  else if (state === 'WAIT_QR') {
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`;
    ctx.replyWithPhoto(qr, { caption: '🔳 QR-код для вашего текста готов!', ...mainMenu });
    ctx.session.state = null;
  }
  else if (state === 'WAIT_BC' && uid === ADMIN_ID) {
    const all = Object.keys(db.users);
    let count = 0;
    for (const id of all) {
      try {
        await bot.telegram.sendMessage(id, `📢 *ОБЪЯВЛЕНИЕ:* \n\n${text}`, { parse_mode: 'Markdown' });
        count++;
      } catch (e) {}
    }
    ctx.reply(`✅ Рассылка завершена. Получили: ${count} пользователей.`, mainMenu);
    ctx.session.state = null;
  }
});

// --- 9. SERVER & BOOT ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }).listen(PORT);

bot.catch((err) => console.error("Global Catch:", err));

setTimeout(() => {
  bot.launch().then(() => console.log('🚀 БОТ ОКОНЧАТЕЛЬНО ПРОВЕРЕН И ЗАПУЩЕН!'));
}, 3000);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
