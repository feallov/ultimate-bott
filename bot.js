const { Telegraf, Markup, session } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const http = require('http');

// --- Configuration (Берем из переменных окружения) ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID); 
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const AI_API_KEY = process.env.AI_API_KEY;

const bot = new Telegraf(BOT_TOKEN);
bot.use(session()); // Enable sessions for state management

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

// Weather
bot.hears('🌤 Погода', (ctx) => {
  ctx.reply('Напишите название города (например: Москва или London):');
  ctx.session = { state: 'WAIT_WEATHER' };
});

// AI Agent
bot.hears('🤖 ИИ Агент', (ctx) => {
  if (!db.settings.ai_enabled) return ctx.reply('❌ ИИ временно отключен администратором.');
  ctx.reply('Отправьте ваш вопрос для ИИ:');
  ctx.session = { state: 'WAIT_AI' };
});

// Currency Rates
bot.hears('💱 Курсы Валют', async (ctx) => {
  try {
    const res = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
    const rub = res.data.rates.RUB;
    const eurInUsd = res.data.rates.EUR;
    const eurToRub = (rub / eurInUsd).toFixed(2);
    
    ctx.reply(`📊 *Актуальные курсы (к рублю):*\n\n🇺🇸 USD: \`${rub}\` ₽\n🇪🇺 EUR: \`${eurToRub}\` ₽\n\n_Обновлено: ${res.data.date}_`, { parse_mode: 'Markdown' });
  } catch (e) {
    ctx.reply('❌ Не удалось получить курсы валют. Попробуйте позже.');
  }
});

// Random Fact / Number
bot.hears('🎲 Рандом', (ctx) => {
  const facts = [
    "Сердце синего кита размером с автомобиль.",
    "Мед — единственный продукт, который никогда не портится.",
    "У коал отпечатки пальцев почти не отличаются от человеческих.",
    "Свет от Солнца доходит до Земли за 8 минут и 20 секунд.",
    "Осьминоги имеют три сердца."
  ];
  const fact = facts[Math.floor(Math.random() * facts.length)];
  const num = Math.floor(Math.random() * 100) + 1;
  
  ctx.reply(`🎲 *Случайное число:* \`${num}\`\n\n💡 *Факт дня:* ${fact}`, { parse_mode: 'Markdown' });
});

// Reminders
bot.hears('⏰ Напоминалка', (ctx) => {
  ctx.reply('Чтобы поставить напоминание, напиши в формате: \n`напомни через 5 минут купить хлеб`', { parse_mode: 'Markdown' });
});

bot.hears(/напомни через (\d+) (минут|минуту|минуты|час|часа|часов)/i, (ctx) => {
  const amount = parseInt(ctx.match[1]);
  const unit = ctx.match[2];
  let ms = amount * 60000;
  if (unit.startsWith('час')) ms *= 60;

  const text = ctx.message.text.split(' ').slice(4).join(' ') || 'Время вышло!';
  
  setTimeout(() => {
    bot.telegram.sendMessage(ctx.from.id, `🔔 *НАПОМИНАНИЕ:* ${text}`, { parse_mode: 'Markdown' });
  }, ms);

  ctx.reply(`✅ Хорошо! Напомню через ${amount} ${unit}.`);
});

// Passwords
bot.hears('🔑 Пароли', (ctx) => {
  const gen = (l) => Array.from({length:l},()=>"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()"[Math.floor(Math.random()*72)]).join('');
  ctx.reply(`✨ Сгенерированные пароли:\n\n🔑 8 симв: \`${gen(8)}\`\n🔑 12 симв: \`${gen(12)}\`\n🔑 20 симв: \`${gen(20)}\``, { parse_mode: 'Markdown' });
});

// Profile
bot.hears('👤 Профиль', (ctx) => {
  const user = db.users[ctx.from.id];
  ctx.reply(`👤 *Ваш профиль:*\n\n🆔 ID: \`${ctx.from.id}\`\n📅 С нами с: ${new Date(user.joined).toLocaleDateString()}\n✉️ Сообщений: ${user.messagesSent}`, { parse_mode: 'Markdown' });
});

// --- Admin Logic ---
bot.command('admin', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply('⛔️ У вас нет прав доступа.');
  ctx.reply('🔧 *Админ-панель:*', { parse_mode: 'Markdown', ...adminHomeMenu });
});

// Admin: Users List
bot.action('adm_users_list', (ctx) => {
  const buttons = Object.entries(db.users).slice(0, 10).map(([id, u]) => [
    Markup.button.callback(`${u.first_name} (${id})`, `inspect_${id}`)
  ]);
  ctx.editMessageText('👥 *Выберите пользователя:*', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([...buttons, [Markup.button.callback('⬅️ Назад', 'adm_home')]])
  });
});

// Admin: Inspect User
bot.action(/inspect_(\d+)/, (ctx) => {
  const targetId = ctx.match[1];
  const u = db.users[targetId];
  if (!u) return ctx.answerCbQuery('Юзер не найден');

  const status = u.isBanned ? '🔴 ЗАБАНЕН' : '🟢 АКТИВЕН';
  const troll = u.trollMode || 'НЕТ';

  ctx.editMessageText(
    `👤 *Юзер:* ${u.first_name}\n🆔 *ID:* \`${targetId}\`\n🏷 *Юзернейм:* @${u.username}\n📊 *Статус:* ${status}\n🤡 *Троллинг:* ${troll}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(u.isBanned ? '✅ Разбанить' : '🚫 Забанить', `toggle_ban_${targetId}`)],
        [Markup.button.callback('🤡 Меню Троллинга', `troll_menu_${targetId}`)],
        [Markup.button.callback('💬 Написать юзеру', `msg_user_${targetId}`)],
        [Markup.button.callback('⬅️ К списку', 'adm_users_list')]
      ])
    }
  );
});

// Admin: Trolling Menu
bot.action(/troll_menu_(\d+)/, (ctx) => {
  const targetId = ctx.match[1];
  ctx.editMessageText(`🤡 *Троллинг для ID:* \`${targetId}\`\nВыберите режим:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Реверс (Mirror)', `set_troll_${targetId}_reverse`)],
      [Markup.button.callback('👻 Хоррор режим', `set_troll_${targetId}_scary`)],
      [Markup.button.callback('💾 Фейк ошибка БД', `set_troll_${targetId}_db_error`)],
      [Markup.button.callback('❔ Почемучка', `set_troll_${targetId}_why`)],
      [Markup.button.callback('🚫 Сбросить всё', `set_troll_${targetId}_none`)],
      [Markup.button.callback('⬅️ Назад', `inspect_${targetId}`)]
    ])
  });
});

// Admin: Apply Trolling
bot.action(/set_troll_(\d+)_(\w+)/, (ctx) => {
  const targetId = ctx.match[1];
  const mode = ctx.match[2] === 'none' ? null : ctx.match[2];
  db.users[targetId].trollMode = mode;
  saveDb();
  ctx.answerCbQuery(`Режим ${mode || 'выключен'} активирован`);
  ctx.editMessageText(`✅ Режим троллинга обновлен на: ${mode || 'Обычный'}`, Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Назад', `troll_menu_${targetId}`)]
  ]));
});

// Admin: Toggle Ban
bot.action(/toggle_ban_(\d+)/, (ctx) => {
  const targetId = ctx.match[1];
  db.users[targetId].isBanned = !db.users[targetId].isBanned;
  saveDb();
  ctx.answerCbQuery('Статус изменен');
  // Trigger inspect again to refresh view
  ctx.editMessageText('Обновление...', Markup.inlineKeyboard([[Markup.button.callback('🔄 Нажмите для обновления', `inspect_${targetId}`)]]));
});

// Admin: Broadcast
bot.action('adm_broadcast', (ctx) => {
  ctx.reply('📢 Введите текст для рассылки всем пользователям:');
  ctx.session = { state: 'WAIT_BROADCAST' };
});

// Admin: Home
bot.action('adm_home', (ctx) => {
  ctx.editMessageText('🔧 *Админ-панель:*', { parse_mode: 'Markdown', ...adminHomeMenu });
});

// --- Text Handler for States & Trolling ---
bot.on('text', async (ctx) => {
  const uid = ctx.from.id;
  const user = db.users[uid];
  const state = ctx.session?.state;

  // 1. TROLLING LOGIC (Highest priority)
  if (user.trollMode && uid !== ADMIN_ID) {
    if (user.trollMode === 'reverse') {
      return ctx.reply(ctx.message.text.split('').reverse().join(''));
    }
    if (user.trollMode === 'scary') {
      const phrases = ['Обернись.', 'Я знаю где ты.', 'Твоя веб-камера включена.', 'Стой прямо.', 'Кто это стоит за тобой?'];
      return ctx.reply(phrases[Math.floor(Math.random()*phrases.length)]);
    }
    if (user.trollMode === 'db_error') {
      return ctx.reply('❌ [FATAL_ERROR]: Database corrupted by user action. Your account is being synchronized... Please do not close the chat.');
    }
    if (user.trollMode === 'why') {
      return ctx.reply(`А почему ты написал "${ctx.message.text}"?`);
    }
  }

  // 2. ADMIN STATES
  if (uid === ADMIN_ID) {
    if (state === 'WAIT_BROADCAST') {
      const allUsers = Object.keys(db.users);
      let count = 0;
      allUsers.forEach(id => {
        bot.telegram.sendMessage(id, `📢 *ОБЪЯВЛЕНИЕ ОТ АДМИНА:*\n\n${ctx.message.text}`, { parse_mode: 'Markdown' })
          .then(() => count++)
          .catch(() => {});
      });
      ctx.reply(`✅ Рассылка завершена. Успешно отправлено: ${allUsers.length} пользователям.`);
      ctx.session = null;
      return;
    }
  }

  // 3. USER STATES
  if (state === 'WAIT_WEATHER') {
    try {
      const res = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(ctx.message.text)}&appid=${WEATHER_API_KEY}&units=metric&lang=ru`);
      const d = res.data;
      ctx.reply(`🌤 Погода в ${d.name}:\n🌡 Температура: ${d.main.temp}°C\n💧 Влажность: ${d.main.humidity}% \n☁️ ${d.weather[0].description}`, mainMenu);
    } catch (e) {
      ctx.reply('❌ Город не найден. Попробуйте еще раз или выберите другую функцию.', mainMenu);
    }
    ctx.session = null;
    return;
  }

  if (state === 'WAIT_AI') {
    ctx.reply('⏳ Думаю...');
    try {
      const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: 'google/gemma-7b-it:free',
        messages: [{ role: 'user', content: ctx.message.text }]
      }, {
        headers: { 'Authorization': `Bearer ${AI_API_KEY}`, 'Content-Type': 'application/json' }
      });
      ctx.reply(res.data.choices[0].message.content, mainMenu);
    } catch (e) {
      ctx.reply('❌ Ошибка ИИ. Проверьте баланс или ключ API.', mainMenu);
    }
    ctx.session = null;
    return;
  }
});

// --- Web Server for Render ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('MultiBot is running...\n');
}).listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

bot.launch();
console.log('Bot started successfully!');

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
