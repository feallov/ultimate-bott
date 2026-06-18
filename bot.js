const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const http = require('http');

// --- Конфигурация (Environment Variables) ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

const bot = new Telegraf(BOT_TOKEN);

// Инициализация сессий
bot.use(session({
  property: 'session',
  getSessionKey: (ctx) => ctx.from && ctx.chat && `${ctx.from.id}:${ctx.chat.id}`
}));

// --- База данных ---
const DB_FILE = './db.json';
let db = { users: {}, settings: { maintenance: false } };

const loadDb = () => {
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE));
    } catch (e) { console.error("Ошибка загрузки БД"); }
  }
};
loadDb();

const saveDb = () => {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) { console.error("Ошибка сохранения БД"); }
};

// --- Middleware: Регистрация и проверка прав ---
bot.use((ctx, next) => {
  if (!ctx.from) return next();
  const uid = ctx.from.id;

  if (!db.users[uid]) {
    db.users[uid] = {
      first_name: ctx.from.first_name,
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
    return ctx.reply('🛑 Ваш доступ к боту заблокирован администратором.');
  }
  
  return next();
});

// --- Клавиатуры ---
const mainMenu = Markup.keyboard([
  ['🌤 Погода', '📖 Википедия'],
  ['💱 Валюты & Крипто', '⏰ Напоминалка'],
  ['🔑 Пароли', '🎲 Рандом'],
  ['👤 Профиль', 'ℹ️ Помощь']
]).resize();

const adminMenu = Markup.inlineKeyboard([
  [Markup.button.callback('👥 Список юзеров', 'adm_users')],
  [Markup.button.callback('📢 Сделать рассылку', 'adm_broadcast')]
]);

// --- Команды ---
bot.start((ctx) => {
  ctx.session = {}; // Сброс сессии при старте
  ctx.reply(`👋 Привет, ${ctx.from.first_name}! Я твой многофункциональный помощник.\n\nВсе системы работают в штатном режиме.`, mainMenu);
});

bot.command('admin', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  ctx.reply('🔧 Панель управления Хозяина:', adminMenu);
});

// --- Обработка кнопок ---

// 🌤 ПОГОДА
bot.hears('🌤 Погода', (ctx) => {
  ctx.reply('Напишите название города (например: Москва):');
  ctx.session = { state: 'WAIT_WEATHER' };
});

// 📖 ВИКИПЕДИЯ
bot.hears('📖 Википедия', (ctx) => {
  ctx.reply('🔍 Введите тему для поиска:');
  ctx.session = { state: 'WAIT_WIKI' };
});

// 💱 ВАЛЮТЫ
bot.hears('💱 Валюты & Крипто', async (ctx) => {
  ctx.reply('⌛️ Получаю данные с бирж...');
  try {
    const fiat = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
    const rub = fiat.data.rates.RUB;
    const btc = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCTUSD');
    
    const text = `📊 *Курсы валют:* \n\n` +
                 `🇺🇸 USD: \`${rub.toFixed(2)}\` ₽\n` +
                 `🇪🇺 EUR: \`${(rub / fiat.data.rates.EUR).toFixed(2)}\` ₽\n` +
                 `🇨🇳 CNY: \`${(rub / fiat.data.rates.CNY).toFixed(2)}\` ₽\n\n` +
                 `₿ Bitcoin: \`$${parseFloat(btc.data.price).toFixed(0)}\``;
    ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply('❌ Ошибка API. Повторите попытку через минуту.');
  }
});

// 🎲 РАНДОМ
bot.hears('🎲 Рандом', (ctx) => {
  ctx.reply('Выберите режим рандома:', Markup.inlineKeyboard([
    [Markup.button.callback('🔢 Число (1-100)', 'rnd_n'), Markup.button.callback('🪙 Монетка', 'rnd_c')],
    [Markup.button.callback('🎲 Кубик', 'rnd_d'), Markup.button.callback('💡 Факт', 'rnd_f')]
  ]));
});

// 🔑 ПАРОЛИ
bot.hears('🔑 Пароли', (ctx) => {
  ctx.reply('Тип пароля:', Markup.inlineKeyboard([
    [Markup.button.callback('🔢 Только цифры', 'pass_n'), Markup.button.callback('🔤 Микс', 'pass_m')],
    [Markup.button.callback('🛡 Сложный', 'pass_h')]
  ]));
});

// ⏰ НАПОМИНАЛКИ
bot.hears('⏰ Напоминалка', (ctx) => {
  ctx.reply('Пример: `напомни через 10 минут проверить почту`', { parse_mode: 'Markdown' });
});

bot.hears(/напомни через (\d+) (минут|минуту|минуты|час|часа|часов)/i, (ctx) => {
  const amount = parseInt(ctx.match[1]);
  let ms = amount * 60000;
  if (ctx.match[2].startsWith('час')) ms *= 60;
  const msg = ctx.message.text.split(' ').slice(4).join(' ') || 'Время вышло!';
  
  setTimeout(() => {
    ctx.reply(`🔔 *НАПОМИНАНИЕ:* ${msg}`, { parse_mode: 'Markdown' });
  }, ms);
  ctx.reply(`✅ Ок, напомню через ${amount} ${ctx.match[2]}.`);
});

bot.hears('👤 Профиль', (ctx) => {
  const u = db.users[ctx.from.id];
  ctx.reply(`👤 *Ваш профиль:*\n\n🆔 ID: \`${ctx.from.id}\`\n✉️ Сообщений отправлено: ${u.messagesSent}`, { parse_mode: 'Markdown' });
});

bot.hears('ℹ️ Помощь', (ctx) => ctx.reply('Используй меню для навигации. Если бот не реагирует, нажми /start.'));

// --- Обработка Action (кнопок) ---

bot.action(/rnd_(\w+)/, (ctx) => {
  const t = ctx.match[1];
  ctx.answerCbQuery();
  if (t === 'n') return ctx.reply(`🔢 Число: ${Math.floor(Math.random()*100)+1}`);
  if (t === 'c') return ctx.reply(`🪙 Результат: ${Math.random() > 0.5 ? 'Орел' : 'Решка'}`);
  if (t === 'd') return ctx.replyWithDice();
  if (t === 'f') {
    const facts = ["У осьминога 3 сердца.", "Пчелы могут летать выше Эвереста.", "Мед не портится."];
    return ctx.reply(`💡 Факт: ${facts[Math.floor(Math.random()*facts.length)]}`);
  }
});

bot.action(/pass_(\w+)/, (ctx) => {
  const t = ctx.match[1];
  let charset = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  if (t === 'n') charset = "0123456789";
  if (t === 'h') charset += "!@#$%^&*()_+=-";
  const pass = Array.from({length:14}, () => charset[Math.floor(Math.random()*charset.length)]).join('');
  ctx.answerCbQuery();
  ctx.reply(`🔑 Пароль: \`${pass}\``, { parse_mode: 'Markdown' });
});

// --- Админ-действия ---

bot.action('adm_users', (ctx) => {
  const users = Object.entries(db.users).slice(-10);
  const buttons = users.map(([id, u]) => [Markup.button.callback(`${u.first_name} [${id}]`, `ins_${id}`)]);
  ctx.editMessageText('👥 Последние 10 пользователей:', Markup.inlineKeyboard([...buttons, [Markup.button.callback('⬅️ Назад', 'adm_h')]]));
});

bot.action('adm_broadcast', (ctx) => {
  ctx.reply('📢 Введите сообщение для рассылки всем пользователям:');
  ctx.session = { state: 'WAIT_BC' };
});

bot.action(/ins_(\d+)/, (ctx) => {
  const tid = ctx.match[1];
  const u = db.users[tid];
  ctx.editMessageText(`👤 Юзер: ${u.first_name}\n🆔 ID: ${tid}\n🤡 Режим: ${u.trollMode || 'Выкл'}`, Markup.inlineKeyboard([
    [Markup.button.callback(u.isBanned ? '✅ Разбанить' : '🚫 Забанить', `bn_${tid}`)],
    [Markup.button.callback('🤡 Троллинг', `tr_${tid}`)],
    [Markup.button.callback('⬅️ Назад', 'adm_users')]
  ]));
});

bot.action(/tr_(\d+)/, (ctx) => {
  const tid = ctx.match[1];
  ctx.editMessageText(`🤡 Настройка троллинга для ${tid}:`, Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Реверс', `set_${tid}_reverse`), Markup.button.callback('👻 Хоррор', `set_${tid}_scary`)],
    [Markup.button.callback('💾 Ошибка', `set_${tid}_db_error`), Markup.button.callback('❓ Почему?', `set_${tid}_why`)],
    [Markup.button.callback('🚫 Выключить', `set_${tid}_none`), Markup.button.callback('⬅️ Назад', `ins_${tid}`)]
  ]));
});

bot.action(/set_(\d+)_(\w+)/, (ctx) => {
  const tid = ctx.match[1];
  db.users[tid].trollMode = ctx.match[2] === 'none' ? null : ctx.match[2];
  saveDb();
  ctx.answerCbQuery('Применено');
  ctx.editMessageText('✅ Режим обновлен.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `ins_${tid}`)]]));
});

bot.action(/bn_(\d+)/, (ctx) => {
  const tid = ctx.match[1];
  db.users[tid].isBanned = !db.users[tid].isBanned;
  saveDb();
  ctx.editMessageText('✅ Статус изменен.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `ins_${tid}`)]]));
});

bot.action('adm_h', (ctx) => ctx.editMessageText('🔧 Панель управления:', adminMenu));

// --- Главный обработчик текста ---

bot.on('text', async (ctx) => {
  const uid = ctx.from.id;
  const user = db.users[uid];
  const state = ctx.session?.state;

  // 1. ТРОЛЛИНГ (Если юзер не админ)
  if (user.trollMode && uid !== ADMIN_ID) {
    if (user.trollMode === 'reverse') return ctx.reply(ctx.message.text.split('').reverse().join(''));
    if (user.trollMode === 'scary') return ctx.reply(['Я за тобой наблюдаю... 👀', 'Оглянись.', 'Ты не один в комнате.'].sort(() => 0.5-Math.random())[0]);
    if (user.trollMode === 'db_error') return ctx.reply('❌ [SYSTEM_ERROR]: DB_SYNC_FAILED. Connection lost.');
    if (user.trollMode === 'why') return ctx.reply(`А зачем ты мне это пишешь?`);
  }

  // 2. ОБРАБОТКА СОСТОЯНИЙ
  if (!state) return;

  if (state === 'WAIT_WEATHER') {
    try {
      const res = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(ctx.message.text)}&appid=${WEATHER_API_KEY}&units=metric&lang=ru`);
      ctx.reply(`🌤 *${res.data.name}:* ${res.data.main.temp}°C, ${res.data.weather[0].description}`, mainMenu);
    } catch (e) { ctx.reply('❌ Город не найден.', mainMenu); }
  } 
  else if (state === 'WAIT_WIKI') {
    try {
      const search = await axios.get(`https://ru.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(ctx.message.text)}&limit=1&format=json`);
      if (search.data[1][0]) {
        const res = await axios.get(`https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(search.data[1][0])}`);
        ctx.reply(`📖 *${res.data.title}*\n\n${res.data.extract}\n\n🔗 [Читать полностью](${res.data.content_urls.desktop.page})`, { parse_mode: 'Markdown', ...mainMenu });
      } else { ctx.reply('❌ Ничего не найдено.', mainMenu); }
    } catch (e) { ctx.reply('❌ Ошибка Википедии.', mainMenu); }
  }
  else if (state === 'WAIT_BC' && uid === ADMIN_ID) {
    const allUsers = Object.keys(db.users);
    let count = 0;
    allUsers.forEach(id => {
      bot.telegram.sendMessage(id, `📢 *СООБЩЕНИЕ ОТ АДМИНИСТРАЦИИ:*\n\n${ctx.message.text}`, { parse_mode: 'Markdown' })
        .then(() => count++)
        .catch(() => {});
    });
    ctx.reply(`✅ Рассылка запущена для ${allUsers.length} юзеров.`);
  }

  ctx.session = {}; // Сброс состояния
});

// --- Сервер для Render ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Active'); }).listen(PORT);

// Глобальная обработка ошибок
bot.catch((err, ctx) => {
  console.log(`Ooops, encountered an error for ${ctx.updateType}`, err);
});

// Запуск с защитой от 409
setTimeout(() => {
  bot.launch().then(() => console.log('🚀 Бот успешно запущен!'));
}, 3000);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
