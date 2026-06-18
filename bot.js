const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const http = require('http');

// --- Configuration ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// --- DB Logic ---
const DB_FILE = './db.json';
let db = { users: {}, settings: { maintenance: false } };
if (fs.existsSync(DB_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DB_FILE)); } catch (e) {}
}
const saveDb = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// --- Middleware ---
bot.use((ctx, next) => {
  if (!ctx.from) return next();
  const uid = ctx.from.id;
  if (!db.users[uid]) {
    db.users[uid] = { first_name: ctx.from.first_name, username: ctx.from.username || 'n/a', joined: new Date().toISOString(), isBanned: false, trollMode: null, messagesSent: 0 };
  }
  db.users[uid].messagesSent++;
  saveDb();
  if (db.users[uid].isBanned && uid !== ADMIN_ID) return ctx.reply('🛑 Доступ заблокирован.');
  return next();
});

// --- Menus ---
const mainMenu = Markup.keyboard([
  ['🌤 Погода', '📖 Википедия'],
  ['💱 Валюты & Крипто', '⏰ Напоминалка'],
  ['🔑 Пароли', '🎲 Рандом'],
  ['👤 Профиль', 'ℹ️ Помощь']
]).resize();

const adminMenu = Markup.inlineKeyboard([
  [Markup.button.callback('👥 Список юзеров', 'adm_users')],
  [Markup.button.callback('📢 Рассылка', 'adm_bc')],
  [Markup.button.callback('🛠 Настройки', 'adm_sett')]
]);

bot.start((ctx) => ctx.reply(`👋 Привет, ${ctx.from.first_name}! Бот v4.0 готов к работе.`, mainMenu));

// --- Handlers ---

// WEATHER
bot.hears('🌤 Погода', (ctx) => {
  ctx.reply('Введите город:');
  ctx.session = { state: 'WAIT_WEATHER' };
});

// WIKIPEDIA
bot.hears('📖 Википедия', (ctx) => {
  ctx.reply('🔍 Что ищем?');
  ctx.session = { state: 'WAIT_WIKI' };
});

// CURRENCY
bot.hears('💱 Валюты & Крипто', async (ctx) => {
  ctx.reply('⌛️ Получаю курсы...');
  try {
    const fiat = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
    const rub = fiat.data.rates.RUB;
    const crypto = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,the-open-network&vs_currencies=usd');
    
    const text = `📊 *Курсы Валют:* \n🇺🇸 USD: \`${rub}\` ₽\n🇪🇺 EUR: \`${(rub / fiat.data.rates.EUR).toFixed(2)}\` ₽\n🇨🇳 CNY: \`${(rub / fiat.data.rates.CNY).toFixed(2)}\` ₽\n\n` +
                 `💎 TON: \`$${crypto.data['the-open-network']?.usd || '?'}\`\n₿ BTC: \`$${crypto.data.bitcoin?.usd || '?'}\``;
    ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (e) { ctx.reply('❌ Ошибка API. Попробуйте позже.'); }
});

// RANDOM WITH FILTERS
bot.hears('🎲 Рандом', (ctx) => {
  ctx.reply('Выберите тип рандома:', Markup.inlineKeyboard([
    [Markup.button.callback('🔢 Число (1-100)', 'rnd_num'), Markup.button.callback('🪙 Орел/Решка', 'rnd_coin')],
    [Markup.button.callback('🎲 Кубик', 'rnd_dice'), Markup.button.callback('💡 Факт', 'rnd_fact')]
  ]));
});

bot.action(/rnd_(\w+)/, (ctx) => {
  const type = ctx.match[1];
  ctx.answerCbQuery();
  if (type === 'num') return ctx.reply(`🎲 Случайное число: *${Math.floor(Math.random()*100)+1}*`, { parse_mode: 'Markdown' });
  if (type === 'coin') return ctx.reply(`🪙 Результат: *${Math.random() > 0.5 ? 'Орел' : 'Решка'}*`, { parse_mode: 'Markdown' });
  if (type === 'dice') return ctx.reply(`🎲 На кубике выпало: *${Math.floor(Math.random()*6)+1}*`, { parse_mode: 'Markdown' });
  if (type === 'fact') {
    const f = ["У осьминога 3 сердца.", "Мед не портится.", "Коалы спят по 22 часа.", "Ленивцы задерживают дыхание на 40 минут."];
    return ctx.reply(`💡 Факт: ${f[Math.floor(Math.random()*f.length)]}`);
  }
});

// PASSWORDS
bot.hears('🔑 Пароли', (ctx) => {
  ctx.reply('Тип пароля:', Markup.inlineKeyboard([
    [Markup.button.callback('🔢 Цифры', 'gp_n'), Markup.button.callback('🔤 Буквы+Цифры', 'gp_m')],
    [Markup.button.callback('🛡 Сложный', 'gp_h')]
  ]));
});

bot.action(/gp_(\w+)/, (ctx) => {
  let ch = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  if (ctx.match[1] === 'n') ch = "01234567890123456789";
  if (ctx.match[1] === 'h') ch += "!@#$%^&*()_+=-";
  const pass = Array.from({length:14}, () => ch[Math.floor(Math.random()*ch.length)]).join('');
  ctx.answerCbQuery();
  ctx.reply(`🔑 Пароль: \`${pass}\``, { parse_mode: 'Markdown' });
});

// --- Admin & Trolling ---
bot.command('admin', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply('⛔️');
  ctx.reply('🔧 Админ-панель:', adminMenu);
});

bot.action('adm_users', (ctx) => {
  const buttons = Object.entries(db.users).slice(-10).map(([id, u]) => [Markup.button.callback(`${u.first_name} [${id}]`, `ins_${id}`)]);
  ctx.editMessageText('👥 Последние юзеры:', Markup.inlineKeyboard([...buttons, [Markup.button.callback('⬅️ Назад', 'adm_home')]]));
});

bot.action(/ins_(\d+)/, (ctx) => {
  const tid = ctx.match[1];
  const u = db.users[tid];
  ctx.editMessageText(`👤 ${u.first_name}\n🆔 ${tid}\n🤡 Троллинг: ${u.trollMode || 'Нет'}`, Markup.inlineKeyboard([
    [Markup.button.callback(u.isBanned ? '✅ Разбанить' : '🚫 Забанить', `ban_${tid}`)],
    [Markup.button.callback('🤡 Меню Троллинга', `troll_${tid}`)],
    [Markup.button.callback('⬅️ Назад', 'adm_users')]
  ]));
});

bot.action(/troll_(\d+)/, (ctx) => {
  const tid = ctx.match[1];
  ctx.editMessageText(`🤡 Режимы для ${tid}:`, Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Реверс', `set_${tid}_reverse`), Markup.button.callback('👻 Хоррор', `set_${tid}_scary`)],
    [Markup.button.callback('💾 Ошибка БД', `set_${tid}_db_error`), Markup.button.callback('❓ Почемучка', `set_${tid}_why`)],
    [Markup.button.callback('🚫 Выкл', `set_${tid}_none`), Markup.button.callback('⬅️ Назад', `ins_${tid}`)]
  ]));
});

bot.action(/set_(\d+)_(\w+)/, (ctx) => {
  const tid = ctx.match[1];
  db.users[tid].trollMode = ctx.match[2] === 'none' ? null : ctx.match[2];
  saveDb();
  ctx.answerCbQuery('Установлено!');
  ctx.editMessageText('✅ Режим обновлен.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `ins_${tid}`)]]));
});

bot.action(/ban_(\d+)/, (ctx) => {
  const tid = ctx.match[1];
  db.users[tid].isBanned = !db.users[tid].isBanned;
  saveDb();
  ctx.editMessageText('✅ Статус изменен.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `ins_${tid}`)]]));
});

bot.action('adm_home', (ctx) => ctx.editMessageText('🔧 Админ-панель:', adminMenu));

// --- Final Processing ---
bot.on('text', async (ctx) => {
  const uid = ctx.from.id;
  const user = db.users[uid];
  const state = ctx.session?.state;

  // TROLLING LOGIC
  if (user.trollMode && uid !== ADMIN_ID) {
    if (user.trollMode === 'reverse') return ctx.reply(ctx.message.text.split('').reverse().join(''));
    if (user.trollMode === 'scary') return ctx.reply(['Я за тобой слежу... 👁', 'Оглянись.', 'Кто это за дверью?'].sort(() => 0.5-Math.random())[0]);
    if (user.trollMode === 'db_error') return ctx.reply('❌ [FATAL ERROR]: Database cluster failed. Your messages are lost.');
    if (user.trollMode === 'why') return ctx.reply(`А почему ты написал именно "${ctx.message.text}"?`);
  }

  if (state === 'WAIT_WEATHER') {
    try {
      const res = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(ctx.message.text)}&appid=${WEATHER_API_KEY}&units=metric&lang=ru`);
      ctx.reply(`🌤 ${res.data.name}: ${res.data.main.temp}°C, ${res.data.weather[0].description}`, mainMenu);
    } catch (e) { ctx.reply('❌ Город не найден.', mainMenu); }
  } 
  
  if (state === 'WAIT_WIKI') {
    try {
      const search = await axios.get(`https://ru.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(ctx.message.text)}&limit=1&format=json`);
      const title = search.data[1][0];
      if (title) {
        const res = await axios.get(`https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
        ctx.reply(`📖 *${res.data.title}*\n\n${res.data.extract}\n\n🔗 [Читать полностью](${res.data.content_urls.desktop.page})`, { parse_mode: 'Markdown', ...mainMenu });
      } else { ctx.reply('❌ Тема не найдена.', mainMenu); }
    } catch (e) { ctx.reply('❌ Ошибка Вики.', mainMenu); }
  }
  ctx.session = null;
});

// Server & Launch
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Alive'); }).listen(PORT);

setTimeout(() => {
  bot.launch().then(() => console.log('✅ Бот запущен!'));
}, 2000);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
