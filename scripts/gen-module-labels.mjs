import fs from 'fs';
import { fileURLToPath } from 'url';
const root = fileURLToPath(new URL('..', import.meta.url));
const s = fs.readFileSync(`${root}/src/ModuleLibrary.jsx`, 'utf8');
const modules = [];
const chunks = s.split(/category:\s*"/).slice(1);
for (const ch of chunks) {
  const catM = /^([^"]+)/.exec(ch);
  if (!catM) continue;
  const category = catM[1];
  const itemRe = /id:\s*"([^"]+)",\s*\n\s*name:\s*"([^"]*)",\s*\n\s*desc:\s*"([^"]*)"/g;
  let im;
  while ((im = itemRe.exec(ch)) !== null) {
    modules.push({ category, id: im[1], nameRu: im[2], descRu: im[3] });
  }
}

/** Human translations — keyed by module id */
const EN = {
  admin_by_id: { name: 'Admin check by Telegram ID', desc: 'Allows the command only for a given Telegram user ID' },
  admin_by_password: { name: 'Admin check by password', desc: 'Enter admin mode with a password' },
  whitelist: { name: 'User whitelist', desc: 'Access only for allowed users' },
  blacklist: { name: 'Blacklist / ban user', desc: 'Block specific users' },
  channel_sub: { name: 'Channel subscription check', desc: 'Requires subscribing to a channel before using the bot' },
  multi_channel_sub: { name: 'Multi-channel subscription check', desc: 'Requires subscribing to several channels' },
  referral: { name: 'Referral system', desc: 'Referral link and invites counter with signup date' },
  one_time_code: { name: 'One-time access code', desc: 'Grants access using a single-use code' },
  captcha: { name: 'Captcha (random math)', desc: 'Anti-spam protection with a random math challenge' },
  new_user_check: { name: 'New vs returning user on /start', desc: 'Different greetings for new and returning users' },
  collect_name_phone: { name: 'Collect name and phone', desc: 'Simple flow to collect contact details' },
  full_profile: { name: 'Full profile (name, phone, city, email)', desc: 'Extended registration form' },
  edit_profile: { name: 'Edit profile', desc: 'Menu to change profile fields' },
  delete_account: { name: 'Delete account', desc: 'Safely remove user data with confirmation' },
  view_profile: { name: 'View my profile', desc: 'Show saved user fields' },
  main_menu: { name: 'Main menu with buttons', desc: 'Standard main menu' },
  menu_back: { name: 'Menu with Back button', desc: 'Submenu with return navigation' },
  nested_menu: { name: 'Nested menu (2 levels)', desc: 'Two-level hierarchical menu' },
  pagination: { name: 'List pagination', desc: 'Browse long lists page by page' },
  admin_menu: { name: 'Admin menu', desc: 'Extended commands for administrators' },
  user_menu: { name: 'User menu', desc: 'Standard user-facing menu' },
  add_product: { name: 'Add product', desc: 'Form to add a product (admin)' },
  view_catalog: { name: 'Browse catalog', desc: 'Show products with buttons' },
  search_product: { name: 'Search product', desc: 'Find products by name' },
  filter_category: { name: 'Filter by category', desc: 'Filter catalog by category' },
  favorites: { name: 'Favorites', desc: 'Save and view favorite products' },
  add_to_cart: { name: 'Add to cart', desc: 'Accumulate items in a cart' },
  view_cart: { name: 'View cart', desc: 'Show cart contents and total' },
  checkout: { name: 'Checkout', desc: 'Full order placement flow' },
  order_history: { name: 'Order history', desc: 'Show past orders' },
  order_status: { name: 'Order status', desc: 'Check current order status' },
  invoice: { name: 'Create invoice', desc: 'Create and send a payment invoice' },
  balance: { name: 'User balance', desc: 'View and manage balance' },
  broadcast_all: { name: 'Broadcast to all users', desc: 'Send a message to every user (admin)' },
  notify_admin: { name: 'Notify administrator', desc: 'DM the admin when something happens' },
  subscribe_newsletter: { name: 'Subscribe / unsubscribe', desc: 'Manage newsletter segments' },
  feedback_form: { name: 'Feedback form', desc: 'Simple message to the administrator' },
  star_rating: { name: 'Star rating (1–5)', desc: 'Ask for a 1–5 star rating' },
  quick_rating: { name: 'Quick rating (👍/👎)', desc: 'Thumbs up/down with alerts on negatives' },
  quiz: { name: 'Quiz with choices', desc: 'Quiz with questions and answer buttons' },
  guess_number: { name: 'Guess the number game', desc: 'Number guessing with hints' },
  random_fact: { name: 'Random fact / quote', desc: 'Pick a random line as content' },
  user_count: { name: 'User count (admin)', desc: 'Global user counter via shared DB' },
  top_users: { name: 'Top users', desc: 'Leaderboard by activity' },
  choose_language: { name: 'Choose language on start', desc: 'Detect Telegram language or ask explicitly' },
  change_language: { name: 'Change language in profile', desc: 'Language switch in settings' },
  faq: { name: 'FAQ', desc: 'Answers to common questions' },
  ticket_system: { name: 'Ticket system', desc: 'Support tickets with admin notification' },
  calculator: { name: 'Calculator', desc: 'Simple math evaluator' },
  qr_generator: { name: 'QR code generator', desc: 'QR workflow with FSM (token-safe)' },
  json_save_field: { name: 'Save one JSON field', desc: 'Write one key in per-user JSON storage' },
  json_read_field: { name: 'Read one DB field', desc: 'Read a single key from user storage' },
  json_read_all: { name: 'Show full user profile JSON', desc: 'Dump all saved keys for the user' },
  json_update_field: { name: 'Update JSON field', desc: 'Change one field without losing others' },
  json_delete_field: { name: 'Delete JSON field', desc: 'Remove a key entirely' },
  json_delete_all: { name: 'Reset all user JSON', desc: 'Clear all keys for the user' },
  json_save_full_profile: { name: 'Save full profile to DB', desc: 'Collect fields and store the whole profile' },
  json_list_records: { name: 'User notes list', desc: 'Store numbered note keys in DB' },
  json_find_by_key: { name: 'Find record by key', desc: 'Check if a key exists and read its value' },
  json_admin_read_user: { name: 'Admin: read another user JSON', desc: 'Admin reads a user’s data by Telegram ID' },
  db_save_simple: { name: 'Save single value', desc: 'Store one value under a key' },
  db_get_simple: { name: 'Get single value', desc: 'Read one key from per-user DB' },
  db_save_profile: { name: 'Save user profile', desc: 'Collect profile fields into DB' },
  db_read_profile: { name: 'Read profile from DB', desc: 'Load profile keys for display' },
  db_update_field: { name: 'Update one profile field', desc: 'Patch one field, keep the rest' },
  db_counter: { name: 'Increment counter', desc: 'Numeric counter in DB' },
  db_catalog: { name: 'Product catalog in DB', desc: 'Add/list products via numbered keys' },
  db_check_registered: { name: 'Registration check', desc: 'Different greetings for new vs returning users' },
  db_ban: { name: 'Ban / unban user', desc: 'Persist ban flag checked on each entry' },
  db_balance: { name: 'User balance (DB)', desc: 'Balance with top-ups and debits' },
  db_all_keys: { name: 'List user DB keys', desc: 'Show every key stored for the user' },
  db_reset: { name: 'Reset user DB', desc: 'Delete keys instead of zeroing values' },
  foreach_list: { name: 'For-each over list', desc: 'Iterate list items and react to each' },
  foreach_db_keys: { name: 'Iterate DB keys', desc: 'Enumerate keys from user storage' },
  while_loop: { name: 'While loop', desc: 'Repeat while a condition holds' },
  repeat_n_times: { name: 'Repeat N times', desc: 'Fixed-count loop' },
  break_continue: { name: 'Break / continue', desc: 'Control flow inside loops' },
  timeout_exec: { name: 'Execute with timeout', desc: 'Bound execution time (e.g. HTTP)' },
  load_json_file: { name: 'Load JSON file', desc: 'Read JSON from disk into a variable' },
  save_json_file: { name: 'Save JSON file', desc: 'Persist data as JSON on disk' },
  delete_file: { name: 'Delete file', desc: 'Remove temp files after use' },
  dict_operations: { name: 'Object (dict) helpers', desc: 'Add/update/remove object fields' },
  parse_json_response: { name: 'Parse JSON API response', desc: 'Turn JSON string into variables' },
  json_to_string: { name: 'Object to JSON string', desc: 'Serialize for API bodies' },
  index_access: { name: 'Index / key access', desc: 'Access list elements and object keys' },
  current_datetime: { name: 'Current date & time', desc: 'Built-in date, time, timestamp helpers' },
  date_format: { name: 'Format date', desc: 'Convert between date formats' },
  save_with_date: { name: 'Save record with timestamp', desc: 'Store data with a time label' },
  random_number: { name: 'Random number', desc: 'Random integer in a range' },
  string_replace: { name: 'String replace', desc: 'Replace substring in text' },
  string_search: { name: 'String search', desc: 'Find substring position or presence' },
  string_slice: { name: 'Slice string/list', desc: 'Substring / sublist via slice()' },
  string_operations: { name: 'String helpers', desc: 'Upper/lower/trim style helpers' },
  http_get_basic: { name: 'HTTP GET', desc: 'Fetch data from an external API' },
  http_post_json: { name: 'HTTP POST JSON', desc: 'Send JSON body to an endpoint' },
  http_with_headers: { name: 'HTTP with auth headers', desc: 'Bearer/token headers for APIs' },
  http_patch: { name: 'HTTP PATCH', desc: 'Partial resource update' },
  http_put: { name: 'HTTP PUT', desc: 'Replace resource entirely' },
  http_delete: { name: 'HTTP DELETE', desc: 'Delete remote resource' },
  webhook_notify: { name: 'Webhook notify', desc: 'POST events to n8n/Make/Zapier' },
  tg_check_sub: { name: 'Check channel subscription', desc: 'Uses getChatMember-style checks' },
  tg_member_role: { name: 'Chat member role', desc: 'creator/admin/member/left detection' },
  tg_forward: { name: 'Forward message', desc: 'Forward inbound message to admin/user' },
  tg_chat_type: { name: 'Detect chat type', desc: 'Different paths for DM/group/supergroup' },
  tg_user_lang: { name: 'User language from Telegram', desc: 'Read Telegram UI language code' },
  tg_notify_user: { name: 'Notify user by ID', desc: 'Send a DM using a Telegram user id' },
  block_as_function: { name: 'Block as function', desc: 'Call a block and capture return value' },
  return_from_handler: { name: 'Early return', desc: 'Exit handler/block with return value' },
  reusable_block: { name: 'Reusable block', desc: 'Snippet reused across handlers' },
  middleware_block: { name: 'Middleware block', desc: 'Run checks/logging before or after updates' },
};

const UK = {
  admin_by_id: { name: 'Перевірка адміна за ID', desc: 'Дозволяє команду лише для заданого Telegram ID' },
  admin_by_password: { name: 'Перевірка адміна за паролем', desc: 'Вхід у режим адміністратора за паролем' },
  whitelist: { name: 'Whitelist користувачів', desc: 'Доступ лише для дозволених користувачів' },
  blacklist: { name: 'Blacklist / бан', desc: 'Блокування певних користувачів' },
  channel_sub: { name: 'Перевірка підписки на канал', desc: 'Вимагає підписку перед використанням бота' },
  multi_channel_sub: { name: 'Підписка на кілька каналів', desc: 'Вимагає підписку на кілька каналів' },
  referral: { name: 'Реферальна система', desc: 'Реферальне посилання та облік запрошень з датою' },
  one_time_code: { name: 'Одноразовий код доступу', desc: 'Доступ за одноразовим кодом' },
  captcha: { name: 'Капча (випадкова математика)', desc: 'Захист від спаму через математичне питання' },
  new_user_check: { name: 'Новий / повернувся користувач', desc: 'Різне привітання для нових і тих, хто повернувся' },
  collect_name_phone: { name: 'Збір імені та телефону', desc: 'Проста форма контактних даних' },
  full_profile: { name: 'Повний профіль', desc: 'Розширена форма реєстрації' },
  edit_profile: { name: 'Редагування профілю', desc: 'Меню зміни даних профілю' },
  delete_account: { name: 'Видалення акаунту', desc: 'Безпечне видалення даних з підтвердженням' },
  view_profile: { name: 'Перегляд профілю', desc: 'Показ збережених даних користувача' },
  main_menu: { name: 'Головне меню з кнопками', desc: 'Стандартне головне меню' },
  menu_back: { name: 'Меню з кнопкою назад', desc: 'Підменю з поверненням' },
  nested_menu: { name: 'Вкладене меню (2 рівні)', desc: 'Дворівневе меню' },
  pagination: { name: 'Пагінація списку', desc: 'Перегляд довгих списків сторінками' },
  admin_menu: { name: 'Меню для адміна', desc: 'Розширені функції для адміністратора' },
  user_menu: { name: 'Меню користувача', desc: 'Стандартне користувацьке меню' },
  add_product: { name: 'Додавання товару', desc: 'Форма для адміна' },
  view_catalog: { name: 'Каталог товарів', desc: 'Вивід каталогу з кнопками' },
  search_product: { name: 'Пошук товару', desc: 'Пошук за назвою' },
  filter_category: { name: 'Фільтр за категорією', desc: 'Фільтрація каталогу' },
  favorites: { name: 'Обране', desc: 'Збереження та перегляд обраного' },
  add_to_cart: { name: 'Додати в кошик', desc: 'Накопичення товарів у кошику' },
  view_cart: { name: 'Кошик', desc: 'Вміст та сума' },
  checkout: { name: 'Оформлення замовлення', desc: 'Повний сценарій замовлення' },
  order_history: { name: 'Історія замовлень', desc: 'Минулі замовлення' },
  order_status: { name: 'Статус замовлення', desc: 'Поточний статус' },
  invoice: { name: 'Рахунок на оплату', desc: 'Створення та надсилання інвойсу' },
  balance: { name: 'Баланс користувача', desc: 'Перегляд та керування балансом' },
  broadcast_all: { name: 'Розсилка всім', desc: 'Повідомлення всім користувачам (адмін)' },
  notify_admin: { name: 'Сповістити адміна', desc: 'Особисте повідомлення адміністратору' },
  subscribe_newsletter: { name: 'Підписка на розсилку', desc: 'Керування сегментами розсилки' },
  feedback_form: { name: 'Форма зворотного зв’язку', desc: 'Повідомлення адміністратору' },
  star_rating: { name: 'Оцінка зірками (1–5)', desc: 'Опитування за шкалою' },
  quick_rating: { name: 'Швидка оцінка (👍/👎)', desc: 'Лайк/дизлайк з алертами' },
  quiz: { name: 'Вікторина з варіантами', desc: 'Питання та кнопки відповідей' },
  guess_number: { name: 'Вгадай число', desc: 'Гра з підказками' },
  random_fact: { name: 'Випадковий факт', desc: 'Випадковий рядок контенту' },
  user_count: { name: 'Кількість користувачів', desc: 'Глобальний лічильник через БД' },
  top_users: { name: 'Топ користувачів', desc: 'Рейтинг за активністю' },
  choose_language: { name: 'Вибір мови при старті', desc: 'Мова Telegram або ручний вибір' },
  change_language: { name: 'Зміна мови в профілі', desc: 'Кнопка в налаштуваннях' },
  faq: { name: 'FAQ', desc: 'Часті запитання' },
  ticket_system: { name: 'Тикет-система', desc: 'Звернення в підтримку з сповіщенням адміна' },
  calculator: { name: 'Калькулятор', desc: 'Прості обчислення' },
  qr_generator: { name: 'Генератор QR', desc: 'QR-модуль з FSM' },
  json_save_field: { name: 'Зберегти поле JSON', desc: 'Один ключ у сховищі користувача' },
  json_read_field: { name: 'Прочитати поле БД', desc: 'Читання одного ключа' },
  json_read_all: { name: 'Увесь профіль JSON', desc: 'Усі збережені дані' },
  json_update_field: { name: 'Оновити поле', desc: 'Зміна без втрати інших полів' },
  json_delete_field: { name: 'Видалити поле', desc: 'Повне видалення ключа' },
  json_delete_all: { name: 'Скинути всі дані', desc: 'Очистити всі ключі' },
  json_save_full_profile: { name: 'Зберегти повний профіль', desc: 'Збір і збереження профілю' },
  json_list_records: { name: 'Список нотаток', desc: 'Нумеровані ключі в БД' },
  json_find_by_key: { name: 'Пошук за ключем', desc: 'Перевірка наявності значення' },
  json_admin_read_user: { name: 'Адмін: дані іншого юзера', desc: 'Читання за Telegram ID' },
  db_save_simple: { name: 'Зберегти значення', desc: 'Один ключ у БД' },
  db_get_simple: { name: 'Отримати значення', desc: 'Читання одного ключа' },
  db_save_profile: { name: 'Зберегти профіль', desc: 'Профіль у БД' },
  db_read_profile: { name: 'Прочитати профіль', desc: 'Завантажити поля для показу' },
  db_update_field: { name: 'Оновити поле профілю', desc: 'Часткове оновлення' },
  db_counter: { name: 'Лічильник', desc: 'Інкремент числа в БД' },
  db_catalog: { name: 'Каталог у БД', desc: 'Товари через ключі' },
  db_check_registered: { name: 'Перевірка реєстрації', desc: 'Нові vs повернувшіся' },
  db_ban: { name: 'Бан / розбан', desc: 'Прапорець бана при вході' },
  db_balance: { name: 'Баланс у БД', desc: 'Нарахування та списання' },
  db_all_keys: { name: 'Список ключів БД', desc: 'Усі ключі користувача' },
  db_reset: { name: 'Скинути БД користувача', desc: 'Видалення ключів' },
  foreach_list: { name: 'Цикл по списку', desc: 'Перебір елементів' },
  foreach_db_keys: { name: 'Перебір ключів БД', desc: 'Ключі зі сховища' },
  while_loop: { name: 'Цикл while', desc: 'Поки умова істинна' },
  repeat_n_times: { name: 'Повторити N разів', desc: 'Фіксована кількість' },
  break_continue: { name: 'Break / continue', desc: 'Керування циклом' },
  timeout_exec: { name: 'Таймаут виконання', desc: 'Обмеження часу (HTTP тощо)' },
  load_json_file: { name: 'Завантажити JSON-файл', desc: 'Читання з диска' },
  save_json_file: { name: 'Зберегти JSON-файл', desc: 'Запис на диск' },
  delete_file: { name: 'Видалити файл', desc: 'Прибрати тимчасові файли' },
  dict_operations: { name: 'Об’єкти (dict)', desc: 'Поля об’єкта' },
  parse_json_response: { name: 'Розбір JSON відповіді', desc: 'Рядок → змінні' },
  json_to_string: { name: 'Об’єкт у JSON-рядок', desc: 'Серіалізація' },
  index_access: { name: 'Індекс / ключ', desc: 'Доступ до елементів' },
  current_datetime: { name: 'Поточна дата й час', desc: 'Вбудовані змінні часу' },
  date_format: { name: 'Формат дати', desc: 'Конвертація форматів' },
  save_with_date: { name: 'Запис з датою', desc: 'Мітка часу' },
  random_number: { name: 'Випадкове число', desc: 'Діапазон' },
  string_replace: { name: 'Заміна в рядку', desc: 'Підрядок' },
  string_search: { name: 'Пошук у рядку', desc: 'Позиція / наявність' },
  string_slice: { name: 'Зріз рядка/списку', desc: 'slice()' },
  string_operations: { name: 'Рядкові операції', desc: 'Регістр, trim тощо' },
  http_get_basic: { name: 'HTTP GET', desc: 'Отримати дані з API' },
  http_post_json: { name: 'HTTP POST JSON', desc: 'Надіслати JSON' },
  http_with_headers: { name: 'HTTP із заголовками', desc: 'Bearer / токен' },
  http_patch: { name: 'HTTP PATCH', desc: 'Часткове оновлення' },
  http_put: { name: 'HTTP PUT', desc: 'Повна заміна ресурсу' },
  http_delete: { name: 'HTTP DELETE', desc: 'Видалення ресурсу' },
  webhook_notify: { name: 'Webhook', desc: 'Події у n8n/Make/Zapier' },
  tg_check_sub: { name: 'Підписка на канал', desc: 'Перевірка через API' },
  tg_member_role: { name: 'Роль у чаті', desc: 'creator/admin/member' },
  tg_forward: { name: 'Пересилання повідомлення', desc: 'До адміна/юзера' },
  tg_chat_type: { name: 'Тип чату', desc: 'Особистий / група' },
  tg_user_lang: { name: 'Мова з Telegram', desc: 'Код мови інтерфейсу' },
  tg_notify_user: { name: 'Повідомити юзера за ID', desc: 'Особисте повідомлення' },
  block_as_function: { name: 'Блок як функція', desc: 'Виклик із поверненням значення' },
  return_from_handler: { name: 'Ранній вихід', desc: 'return у обробнику' },
  reusable_block: { name: 'Повторно використовуваний блок', desc: 'Спільний фрагмент' },
  middleware_block: { name: 'Middleware', desc: 'Перевірки до/після апдейтів' },
};

for (const m of modules) {
  if (!EN[m.id]) console.error('Missing EN:', m.id);
  if (!UK[m.id]) console.error('Missing UK:', m.id);
}

const CAT_EN = {
  '🔐 Доступ и авторизация': '🔐 Access & authorization',
  '👤 Регистрация и профиль': '👤 Registration & profile',
  '🧭 Навигация и меню': '🧭 Navigation & menus',
  '🛍️ Магазин и товары': '🛍️ Shop & products',
  '🛒 Корзина и заказы': '🛒 Cart & orders',
  '💳 Платежи': '💳 Payments',
  '📢 Уведомления и рассылка': '📢 Notifications & broadcasts',
  '💬 Обратная связь': '💬 Feedback',
  '🎮 Игры и викторины': '🎮 Games & quizzes',
  '📊 Статистика и аналитика': '📊 Stats & analytics',
  '🌍 Мультиязычность': '🌍 Localization',
  '🆘 Поддержка': '🆘 Support',
  '📎 Утилиты': '📎 Utilities',
  '🗄️ JSON-хранилище (per-user)': '🗄️ JSON storage (per-user)',
  '🗃️ База данных (per-user)': '🗃️ Database (per-user)',
  '🔄 Циклы и итерации': '🔄 Loops & iteration',
  '📁 Файлы и JSON': '📁 Files & JSON',
  '🕐 Дата и время': '🕐 Date & time',
  '🔧 Строки и данные': '🔧 Strings & data',
  '🌐 HTTP и внешние API': '🌐 HTTP & external APIs',
  '📡 Telegram расширения': '📡 Telegram extras',
  '⚙️ Блоки и функции': '⚙️ Blocks & functions',
};

const CAT_UK = {
  '🔐 Доступ и авторизация': '🔐 Доступ і авторизація',
  '👤 Регистрация и профиль': '👤 Реєстрація та профіль',
  '🧭 Навигация и меню': '🧭 Навігація та меню',
  '🛍️ Магазин и товары': '🛍️ Магазин і товари',
  '🛒 Корзина и заказы': '🛒 Кошик і замовлення',
  '💳 Платежи': '💳 Платежі',
  '📢 Уведомления и рассылка': '📢 Сповіщення та розсилка',
  '💬 Обратная связь': '💬 Зворотний зв’язок',
  '🎮 Игры и викторины': '🎮 Ігри та вікторини',
  '📊 Статистика и аналитика': '📊 Статистика та аналітика',
  '🌍 Мультиязычность': '🌍 Багатомовність',
  '🆘 Поддержка': '🆘 Підтримка',
  '📎 Утилиты': '📎 Утиліти',
  '🗄️ JSON-хранилище (per-user)': '🗄️ JSON-сховище (на користувача)',
  '🗃️ База данных (per-user)': '🗃️ База даних (на користувача)',
  '🔄 Циклы и итерации': '🔄 Цикли та ітерації',
  '📁 Файлы и JSON': '📁 Файли та JSON',
  '🕐 Дата и время': '🕐 Дата й час',
  '🔧 Строки и данные': '🔧 Рядки та дані',
  '🌐 HTTP и внешние API': '🌐 HTTP та зовнішні API',
  '📡 Telegram расширения': '📡 Розширення Telegram',
  '⚙️ Блоки и функции': '⚙️ Блоки та функції',
};

function esc(s) {
  return JSON.stringify(s);
}

let js = `/** Built-in module library labels (en/uk). Categories keyed by Russian label from ModuleLibrary.jsx */
export const LIBRARY_CATEGORY_LABELS = {
  en: {
`;
for (const k of Object.keys(CAT_EN)) {
  js += `    ${esc(k)}: ${esc(CAT_EN[k])},\n`;
}
js += `  },
  uk: {
`;
for (const k of Object.keys(CAT_UK)) {
  js += `    ${esc(k)}: ${esc(CAT_UK[k])},\n`;
}
js += `  },
};

export const LIBRARY_MODULE_LABELS = {
  en: {
`;
for (const [id, v] of Object.entries(EN)) {
  js += `    ${esc(id)}: { name: ${esc(v.name)}, desc: ${esc(v.desc)} },\n`;
}
js += `  },
  uk: {
`;
for (const [id, v] of Object.entries(UK)) {
  js += `    ${esc(id)}: { name: ${esc(v.name)}, desc: ${esc(v.desc)} },\n`;
}
js += `  },
};
`;

fs.writeFileSync(`${root}/src/moduleLibraryBuiltinLabels.js`, js);
console.log('Wrote src/moduleLibraryBuiltinLabels.js');
