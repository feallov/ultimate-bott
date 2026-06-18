const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const http = require('http');

// --- Configuration (Берем из Render Environment) ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// --- Database Logic ---
const DB_FILE = './db.json';
let db = { users: {}, settings: { maintenance: false } };
if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE)); } catch (e) { console.error("DB Load Error"); }
}
const saveDb = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// --- Middleware ---
bot.use((ctx, next) => {
  if (!ctx.from) return next();
  const uid = ctx.from.id;
  if (!db.users[uid]) {
    db.users[uid] = { first_name: ctx.from.first_name, username: ctx.from.username || 'n/a', joined: new Date().toISOString(), isBanned: false, trollMode: null, messagesSent: 0 };
    saveDb();
  }
  db.users[uid].messagesSent++;
  saveDb();
  if (db.users[uid].isBanned && uid !== ADMIN_ID) return ctx.reply('🛑 Доступ заблокирован администратором.');
  return next();
});

// --- Menus ---
const mainMenu = Markup.keyboard([
  ['🌤 Погода', '📖 Википедия'],
  ['💱 Валюты & Крипто', '⏰ Напоминалка'],
  ['🔑 Пароли', '🎲 Рандом'],
  ['👤 Профиль', 'ℹ️ Помощь']
]).resize();

bot.start((ctx) => ctx.reply(`👋 Привет, ${ctx.from.first_name}! Я твой ультимативный бот.\nВыбери нужную функцию в меню ниже.`, mainMenu));

// --- Handlers ---

// 🌤 WEATHER
bot.hears('🌤 Погода', (ctx) => {
  ctx.reply('Введите название города на русском или английском:');
  ctx.session = { state: 'WAIT_WEATHER' };
});

// 📖 WIKIPEDIA
bot.hears('📖 Википедия', (ctx) => {
  ctx.reply('🔍 Напишите тему для поиска в Википедии:');
  ctx.session = { state: 'WAIT_WIKI' };
});

// 💱 CURRENCY & CRYPTO
bot.hears('💱 Валюты & Крипто', async (ctx) => {
  ctx.reply('⏳ Загружаю актуальные данные...');
  try {
    const fiat = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
    const rub = fiat.data.rates.RUB;
    const cny = (rub / fiat.data.rates.CNY).toFixed(2);
    const kzt = (rub / fiat.data.rates.KZT).toFixed(2);
    
    const crypto = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,the-open-network&vs_currencies=usd');
    
    const text = `📊 *Курсы Валют (к рублю):*\n` +
                 `🇺🇸 USD: \`${rub}\` ₽\n` +
                 `🇪🇺 EUR: \`${(rub / fiat.data.rates.EUR).toFixed(2)}\` ₽\n` +
                 `🇨🇳 CNY: \`${cny}\` ₽\n` +
                 `🇰🇿 100 KZT: \`${(kzt * 100).toFixed(2)}\` ₽\n\n` +
                 `🚀 *Криптовалюта (в USD):*\n` +
                 `₿ BTC: \`$${crypto.data.bitcoin.usd}\`\n` +
                 `💎 TON: \`$${crypto.data['the-open-network'].usd}\`\n` +
                 `🔷 ETH: \`$${crypto.data.ethereum.usd}\``;
    
    ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply('❌ Ошибка получения данных. Попробуйте позже.');
  }
});

// 🔑 PASSWORDS WITH FILTERS
bot.hears('🔑 Пароли', (ctx) => {
  ctx.reply('Выберите тип пароля:', Markup.inlineKeyboard([
    [Markup.button.callback('🔢 Только цифры', 'gen_pass_num')],
    [Markup.button.callback('🔤 Буквы + Цифры', 'gen_pass_mix')],
    [Markup.button.callback('🛡 Сложный (со спецсимв.)', 'gen_pass_hard')]
  ]));
});

bot.action(/gen_pass_(\w+)/, (ctx) => {
  const type = ctx.match[1];
  let charset = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  if (type === 'num') charset = "01234567890123456789";
  if (type === 'hard') charset += "!@#$%^&*()_+=-[]{}|;:,.<>?";
  
  const pass = Array.from({length: 12}, () => charset[Math.floor(Math.random() * charset.length)]).join('');
  ctx.answerCbQuery('Пароль сгенерирован!');
  ctx.reply(`🔑 Ваш новый пароль:\n\`${pass}\``, { parse_mode: 'Markdown' });
});

// 🎲 RANDOM
bot.hears('🎲 Рандом', (ctx) => {
  const facts = [
    "Сердце кита размером с автомобиль.",
    "У осьминога 3 сердца.",
    "Мед не портится тысячи лет.",
    "Коалы спят по 22 часа в сутки."
  ];
  ctx.reply(`🎲 Число: *${Math.floor(Math.random()*100)+1}*\n💡 Факт: ${facts[Math.floor(Math.random()*facts.length)]}`, { parse_mode: 'Markdown' });
});

// ⏰ REMINDERS
bot.hears('⏰ Напоминалка', (ctx) => {
  ctx.reply('Напиши: `напомни через 10 минут выпить воды`', { parse_mode: 'Markdown' });
});

bot.hears(/напомни через (\d+) (минут|минуту|минуты|час|часа|часов)/i, (ctx) => {
  const amount = parseInt(ctx.match[1]);
  const unit = ctx.match[2];
  let ms = amount * 60000;
  if (unit.startsWith('час')) ms *= 60;
  
  const note = ctx.message.text.split(' ').slice(4).join(' ') || 'Время вышло!';
  setTimeout(() => {
    ctx.reply(`🔔 *НАПОМИНАНИЕ:* ${note}`, { parse_mode: 'Markdown' });
  }, ms);
  ctx.reply(`✅ Ок! Напомню через ${amount} ${unit}.`);
});

// 👤 PROFILE
bot.hears('👤 Профиль', (ctx) => {
  const u = db.users[ctx.from.id];
  ctx.reply(`👤 *Ваш профиль:*\n🆔 ID: \`${ctx.from.id}\`\n✉️ Сообщений отправлено: ${u.messagesSent}`, { parse_mode: 'Markdown' });
});

// ℹ️ HELP
bot.hears('ℹ️ Помощь', (ctx) => {
  ctx.reply('Этот бот умеет всё! Если есть вопросы — пиши админу.');
});

// --- Admin Section ---
bot.command('admin', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply('⛔️ Доступ только для Хозяина.');
  ctx.reply('🔧 *Админ-панель:*', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('👥 Список пользователей', 'adm_users')],
      [Markup.button.callback('📢 Сделать рассылку', 'adm_bc')]
    ])
  });
});

bot.action('adm_users', (ctx) => {
  const list = Object.entries(db.users).slice(-20).map(([id, u]) => `• ${u.first_name} [${id}] (Msg: ${u.messagesSent})`).join('\n');
  ctx.editMessageText(`👥 *Последние пользователи:*\n\n${list}`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'adm_back')]])
  });
});

bot.action('adm_back', (ctx) => {
  ctx.editMessageText('🔧 *Админ-панель:*', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('👥 Список пользователей', 'adm_users')],
      [Markup.button.callback('📢 Сделать рассылку', 'adm_bc')]
    ])
  });
});

// --- Text Handler for States & Trolling ---
bot.on('text', async (ctx) => {
  const uid = ctx.from.id;
  const user = db.users[uid];
  const state = ctx.session?.state;

  // TROLLING
  if (user.trollMode && uid !== ADMIN_ID) {
    if (user.trollMode === 'reverse') return ctx.reply(ctx.message.text.split('').reverse().join(''));
    if (user.trollMode === 'scary') return ctx.reply('Я вижу тебя через камеру... 👁');
  }

  // STATES
  if (state === 'WAIT_WEATHER') {
    try {
      const res = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(ctx.message.text)}&appid=${WEATHER_API_KEY}&units=metric&lang=ru`);
      ctx.reply(`🌤 *${res.data.name}:* ${res.data.main.temp}°C\n💧 Влажность: ${res.data.main.humidity}%\n☁️ ${res.data.weather[0].description}`, { parse_mode: 'Markdown', ...mainMenu });
    } catch (e) { ctx.reply('❌ Город не найден.', mainMenu); }
    ctx.session = null;
  } 
  else if (state === 'WAIT_WIKI') {
    try {
      const res = await axios.get(`https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(ctx.message.text)}`);
      if (res.data.extract) {
        ctx.reply(`📖 *${res.data.title}*\n\n${res.data.extract}\n\n🔗 [Читать в Википедии](${res.data.content_urls.desktop.page})`, { parse_mode: 'Markdown', ...mainMenu });
      } else { ctx.reply('❌ Ничего не найдено.', mainMenu); }
    } catch (e) { ctx.reply('❌ Ошибка поиска.', mainMenu); }
    ctx.session = null;
  }
});

// --- Server for Render ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Bot is Active'); }).listen(PORT);

bot.launch().then(() => console.log('✅ Bot is running!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
