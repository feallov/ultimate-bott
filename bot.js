const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const http = require('http');

// --- Configuration (Берем из переменных окружения Render) ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const AI_API_KEY = process.env.AI_API_KEY;

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// --- Simple JSON Database ---
const DB_FILE = './db.json';
let db = {
  users: {},
  settings: { maintenance: false, ai_enabled: true }
};

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE));
  } catch (e) { console.error("DB Parse Error", e); }
}

const saveDb = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// --- Middleware: Auth & Tracking ---
bot.use((ctx, next) => {
  if (!ctx.from) return next();
  const uid = ctx.from.id;

  if (!db.users[uid]) {
    db.users[uid] = {
      username: ctx.from.username || 'n/a',
      first_name: ctx.from.first_name,
      joined: new Date().toISOString(),
      isBanned: false,
      trollMode: null,
      messagesSent: 0
    };
    saveDb();
  }

  const user = db.users[uid];
  user.messagesSent++;
  saveDb();

  if (user.isBanned && uid !== ADMIN_ID) {
    return ctx.reply('🛑 Вы заблокированы.');
  }

  if (db.settings.maintenance && uid !== ADMIN_ID) {
    return ctx.reply('🛠 Бот на техническом обслуживании. Зайдите позже.');
  }

  return next();
});

// --- Menus ---
const mainMenu = Markup.keyboard([
  ['🌤 Погода', '🤖 ИИ Агент'],
  ['💱 Курсы Валют', '⏰ Напоминалка'],
  ['🔑 Пароли', '🎲 Рандом'],
  ['👤 Профиль', 'ℹ️ Помощь']
]).resize();

const adminHomeMenu = Markup.inlineKeyboard([
  [Markup.button.callback('👥 Управление Юзерами', 'adm_users_list')],
  [Markup.button.callback('📢 Массовая Рассылка', 'adm_broadcast')],
  [Markup.button.callback('⚙️ Системные Настройки', 'adm_settings')],
  [Markup.button.callback('📊 Статистика БД', 'adm_stats')]
]);

// --- Main Handlers ---
bot.start((ctx) => {
  ctx.reply(`👋 Привет, ${ctx.from.first_name}! Я твой универсальный бот.\n\nИспользуй кнопки ниже для навигации.`, mainMenu);
});

bot.hears('🌤 Погода', (ctx) => {
  ctx.reply('Напишите название города (например: Москва или London):');
  ctx.session = { state: 'WAIT_WEATHER' };
});

bot.hears('🤖 ИИ Агент', (ctx) => {
  if (!db.settings.ai_enabled) return ctx.reply('❌ ИИ временно отключен администратором.');
  ctx.reply('Отправьте ваш вопрос для ИИ (Llama-3 Free):');
  ctx.session = { state: 'WAIT_AI' };
});

bot.hears('💱 Курсы Валют', async (ctx) => {
  try {
    const res = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
    const rub = res.data.rates.RUB;
    const eurInUsd = res.data.rates.EUR;
    const eurToRub = (rub / eurInUsd).toFixed(2);
    ctx.reply(`📊 *Актуальные курсы (к рублю):*\n\n🇺🇸 USD: \`${rub}\` ₽\n🇪🇺 EUR: \`${eurToRub}\` ₽`, { parse_mode: 'Markdown' });
  } catch (e) { ctx.reply('❌ Ошибка получения валют.'); }
});

bot.hears('🎲 Рандом', (ctx) => {
  const facts = ["Осьминоги имеют три сердца.", "Мед не портится.", "У коал есть отпечатки пальцев."];
  const fact = facts[Math.floor(Math.random() * facts.length)];
  ctx.reply(`🎲 Число: ${Math.floor(Math.random()*100)}\n💡 Факт: ${fact}`);
});

bot.hears('⏰ Напоминалка', (ctx) => {
  ctx.reply('Формат: `напомни через 5 минут купить хлеб`', { parse_mode: 'Markdown' });
});

bot.hears(/напомни через (\d+) (минут|минуту|минуты|час|часа|часов)/i, (ctx) => {
  const amount = parseInt(ctx.match[1]);
  const unit = ctx.match[2];
  let ms = amount * 60000;
  if (unit.startsWith('час')) ms *= 60;
  const text = ctx.message.text.split(' ').slice(4).join(' ') || 'Время вышло!';
  setTimeout(() => { bot.telegram.sendMessage(ctx.from.id, `🔔 *НАПОМИНАНИЕ:* ${text}`, { parse_mode: 'Markdown' }); }, ms);
  ctx.reply(`✅ Напомню через ${amount} ${unit}.`);
});

bot.hears('🔑 Пароли', (ctx) => {
  const gen = (l) => Array.from({length:l},()=>"abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*"[Math.floor(Math.random()*60)]).join('');
  ctx.reply(`🔑 12 симв: \`${gen(12)}\``, { parse_mode: 'Markdown' });
});

bot.hears('👤 Профиль', (ctx) => {
  const user = db.users[ctx.from.id];
  ctx.reply(`👤 ID: ${ctx.from.id}\n✉️ Сообщений: ${user.messagesSent}`);
});

// --- Admin Logic ---
bot.command('admin', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply('⛔️ Доступ закрыт.');
  ctx.reply('🔧 Админ-панель:', adminHomeMenu);
});

bot.action('adm_users_list', (ctx) => {
  const buttons = Object.entries(db.users).slice(0, 10).map(([id, u]) => [Markup.button.callback(`${u.first_name} (${id})`, `inspect_${id}`)]);
  ctx.editMessageText('👥 Юзеры:', Markup.inlineKeyboard([...buttons, [Markup.button.callback('⬅️ Назад', 'adm_home')]]));
});

bot.action(/inspect_(\d+)/, (ctx) => {
  const targetId = ctx.match[1];
  const u = db.users[targetId];
  ctx.editMessageText(`👤 ${u.first_name}\n🆔 ${targetId}\n🤡 Троллинг: ${u.trollMode || 'Нет'}`, Markup.inlineKeyboard([
    [Markup.button.callback(u.isBanned ? '✅ Разбанить' : '🚫 Забанить', `toggle_ban_${targetId}`)],
    [Markup.button.callback('🤡 Троллинг', `troll_menu_${targetId}`)],
    [Markup.button.callback('⬅️ Назад', 'adm_users_list')]
  ]));
});

bot.action(/troll_menu_(\d+)/, (ctx) => {
  const targetId = ctx.match[1];
  ctx.editMessageText(`🤡 Режим для ${targetId}:`, Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Реверс', `set_troll_${targetId}_reverse`) + Markup.button.callback('👻 Хоррор', `set_troll_${targetId}_scary`)],
    [Markup.button.callback('🚫 Выключить', `set_troll_${targetId}_none`) + Markup.button.callback('⬅️ Назад', `inspect_${targetId}`)]
  ]));
});

bot.action(/set_troll_(\d+)_(\w+)/, (ctx) => {
  const targetId = ctx.match[1];
  db.users[targetId].trollMode = ctx.match[2] === 'none' ? null : ctx.match[2];
  saveDb();
  ctx.answerCbQuery('Готово');
  ctx.editMessageText('✅ Обновлено', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `inspect_${targetId}`)]]));
});

bot.action(/toggle_ban_(\d+)/, (ctx) => {
  const targetId = ctx.match[1];
  db.users[targetId].isBanned = !db.users[targetId].isBanned;
  saveDb();
  ctx.editMessageText('✅ Статус изменен', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `inspect_${targetId}`)]]));
});

bot.action('adm_home', (ctx) => ctx.editMessageText('🔧 Админ-панель:', adminHomeMenu));

// --- Final Text Handler ---
bot.on('text', async (ctx) => {
  const uid = ctx.from.id;
  const user = db.users[uid];
  const state = ctx.session?.state;

  if (user.trollMode && uid !== ADMIN_ID) {
    if (user.trollMode === 'reverse') return ctx.reply(ctx.message.text.split('').reverse().join(''));
    if (user.trollMode === 'scary') return ctx.reply('Оглянись. Я за тобой наблюдаю... 👀');
  }

  if (state === 'WAIT_WEATHER') {
    try {
      const res = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(ctx.message.text)}&appid=${WEATHER_API_KEY}&units=metric&lang=ru`);
      ctx.reply(`🌤 ${res.data.name}: ${res.data.main.temp}°C, ${res.data.weather[0].description}`, mainMenu);
    } catch (e) { ctx.reply('❌ Город не найден.', mainMenu); }
    ctx.session = null;
    return;
  }

  if (state === 'WAIT_AI') {
    ctx.reply('⏳ Думаю...');
    try {
      const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: 'meta-llama/llama-3-8b-instruct:free',
        messages: [{ role: 'user', content: ctx.message.text }]
      }, {
        headers: { 'Authorization': `Bearer ${AI_API_KEY}`, 'HTTP-Referer': 'https://render.com', 'X-Title': 'MultiBot' }
      });
      ctx.reply(res.data.choices[0]?.message?.content || "Ошибка ответа.", mainMenu);
    } catch (e) { ctx.reply('❌ Ошибка ИИ.', mainMenu); }
    ctx.session = null;
    return;
  }
});

// Web Server for Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Alive'); }).listen(PORT);

bot.launch().then(() => console.log('Bot started!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
