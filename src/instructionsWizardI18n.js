/** Copy for Cicada Studio onboarding wizard (modal). keyed by ui_language */

function ru() {
  return {
    headerPrefix: 'Инструкция',
    back: '← Назад',
    next: 'Далее →',
    done: '✓ Понятно!',
    exampleLabel: 'Пример:',
    sections: [
      {
        id: 'intro',
        emoji: '🚀',
        color: '#ffd700',
        glow: 'rgba(255,215,0,0.2)',
        label: 'Начало',
        title: 'Как пользоваться Cicada Studio',
        subtitle: 'Собирай Telegram-бота как из пазлов 🧩',
        body: [
          ['p', 'Cicada Studio — визуальный конструктор Telegram-ботов. Вместо кода ты работаешь с блоками: перетаскиваешь их на холст, соединяешь и запускаешь бота в один клик.'],
          ['card', '💡', [
            ['text', 'Начни с блоков '],
            ['code', 'Версия'],
            ['text', ' → '],
            ['code', 'Бот'],
            ['text', ' → '],
            ['code', 'Старт'],
            ['text', ' — это минимальный рабочий бот.'],
          ]],
        ],
      },
      {
        id: 'blocks',
        emoji: '🧩',
        color: '#a78bfa',
        glow: 'rgba(167,139,250,0.2)',
        label: 'Блоки',
        title: '1. Добавь блоки',
        subtitle: 'Перетащи блоки из левой панели на холст.',
        body: [
          ['list', '#a78bfa', '👉 Начни с:', [
            { icon: '📌', text: 'Версия' },
            { icon: '🤖', text: 'Бот — обязательно укажи токен' },
            { icon: '▶', text: 'Старт' },
          ]],
          ['p', 'Каждый блок — отдельная инструкция. Блоки бывают настроечные (версия, бот) и событийные (старт, команда, при нажатии).'],
          ['card', '🔍', [['text', 'Используй поиск в библиотеке блоков, чтобы быстро найти нужный.']]],
        ],
      },
      {
        id: 'connect',
        emoji: '🔗',
        color: '#34d399',
        glow: 'rgba(52,211,153,0.2)',
        label: 'Соединение',
        title: '2. Соединяй блоки',
        subtitle: 'Соединяй их сверху вниз — как конструктор.',
        body: [
          ['p', 'Порядок блоков в стеке определяет логику бота. Верхний блок — триггер, нижние — реакции.'],
          ['example', [
            { icon: '▶', color: '#3ecf8e', text: 'Старт' },
            { icon: '✉', color: '#5b7cf6', text: 'Ответ → Привет!' },
            { icon: '⊞', color: '#a78bfa', text: 'Кнопки → [Меню] [Помощь]' },
          ]],
          ['card', '⚡', [['text', 'Блоки внутри одного стека выполняются последовательно, сверху вниз.']]],
        ],
      },
      {
        id: 'settings',
        emoji: '✏️',
        color: '#60a5fa',
        glow: 'rgba(96,165,250,0.2)',
        label: 'Настройки',
        title: '3. Настрой блок',
        subtitle: 'Нажми на блок и задай параметры.',
        body: [
          ['list', '#60a5fa', 'Что можно задать:', [
            { icon: '📝', text: 'Текст сообщения' },
            { icon: '⌨', text: 'Команду (например /help)' },
            { icon: '📦', text: 'Переменные {{имя}}' },
          ]],
          ['card', '💡', [
            ['text', 'Используй переменную '],
            ['code', '{{имя}}'],
            ['text', ' в тексте для подстановки данных.'],
          ]],
        ],
      },
      {
        id: 'logic',
        emoji: '⚡',
        color: '#fb923c',
        glow: 'rgba(251,146,60,0.2)',
        label: 'Логика',
        title: '4. Добавь логику',
        subtitle: 'Ветвление, циклы и переменные.',
        body: [
          ['list', '#fb923c', 'Блоки логики:', [
            { icon: '🔀', text: 'Если — проверка условия' },
            { icon: '❓', text: 'Спросить — ввод от пользователя' },
            { icon: '💾', text: 'Сохранить — запись в память' },
            { icon: '⏱', text: 'Задержка — пауза в секундах' },
          ]],
          ['card', '🎯', [['text', 'Значения переменных сохраняются между шагами одного сценария.']]],
        ],
      },
      {
        id: 'run',
        emoji: '▶',
        color: '#3ecf8e',
        glow: 'rgba(62,207,142,0.2)',
        label: 'Запуск',
        title: '5. Запусти бота',
        subtitle: 'Проверь, сгенерируй и скачай .ccd файл.',
        body: [
          ['list', '#3ecf8e', 'Шаги:', [
            { icon: '1️⃣', text: 'Проверь ошибки (кнопка ✔ Проверить)' },
            { icon: '2️⃣', text: 'Нажми «Генерировать»' },
            { icon: '3️⃣', text: 'Скачай .ccd кнопкой ↓' },
            { icon: '4️⃣', text: 'Запусти: cicada bot.ccd' },
          ]],
          ['codeblock', [
            { c: '#94a3b8', t: '# Установка' },
            { c: '#e2e8f0', t: 'pip install cicada-tg' },
            { c: '#94a3b8', t: '# Запуск' },
            { c: '#3ecf8e', t: 'cicada bot.ccd' },
          ]],
        ],
      },
      {
        id: 'install',
        emoji: '🖥️',
        color: '#38bdf8',
        glow: 'rgba(56,189,248,0.2)',
        label: 'Установка',
        title: '6. Установка на ПК',
        subtitle: 'Python 3.10+ и pip — всё что нужно.',
        body: [
          ['list', '#38bdf8', 'Требования:', [
            { icon: '🐍', text: 'Python 3.10+ (python.org)' },
            { icon: '📦', text: 'pip (входит в Python)' },
            { icon: '🤖', text: 'Telegram Bot Token от @BotFather' },
          ]],
          ['pStyled', { color: '#38bdf8', fontSize: 12, marginBottom: 6 }, '🪟 Windows (cmd / PowerShell):'],
          ['codeblock', [{ c: '#e2e8f0', t: 'pip install cicada-tg' }]],
          ['pStyled', { color: '#38bdf8', fontSize: 12, marginBottom: 6 }, '🐧 Linux / macOS:'],
          ['codeblock', [{ c: '#e2e8f0', t: 'pip install cicada-tg --break-system-packages' }]],
          ['card', '⚠️', [['text', 'На Windows при установке Python поставь галочку «Add Python to PATH».']]],
        ],
      },
      {
        id: 'tips',
        emoji: '⭐',
        color: '#f472b6',
        glow: 'rgba(244,114,182,0.2)',
        label: 'Важно',
        title: '7. Важные правила',
        subtitle: 'Без этого бот не запустится.',
        body: [
          ['list', '#ef4444', '⚠️ Обязательно:', [
            { icon: '🔗', text: 'Блоки должны быть соединены в стек' },
            { icon: '▶', text: 'Должен быть блок Старт' },
            { icon: '🤖', text: 'В блоке Бот нужен токен' },
          ]],
          ['pStyled', { textAlign: 'center', color: '#ffd700', fontSize: 16, marginTop: 20 }, '🎉 Готово! Собирай своего бота!'],
        ],
      },
    ],
  };
}

function en() {
  return {
    headerPrefix: 'Guide',
    back: '← Back',
    next: 'Next →',
    done: '✓ Got it!',
    exampleLabel: 'Example:',
    sections: [
      {
        id: 'intro',
        emoji: '🚀',
        color: '#ffd700',
        glow: 'rgba(255,215,0,0.2)',
        label: 'Start',
        title: 'How to use Cicada Studio',
        subtitle: 'Build a Telegram bot like a puzzle 🧩',
        body: [
          ['p', 'Cicada Studio is a visual builder for Telegram bots. Instead of raw code you drag blocks onto the canvas, connect them, and launch the bot in one click.'],
          ['card', '💡', [
            ['text', 'Start with '],
            ['code', 'Version'],
            ['text', ' → '],
            ['code', 'Bot'],
            ['text', ' → '],
            ['code', 'Start'],
            ['text', ' — that is the smallest working bot.'],
          ]],
        ],
      },
      {
        id: 'blocks',
        emoji: '🧩',
        color: '#a78bfa',
        glow: 'rgba(167,139,250,0.2)',
        label: 'Blocks',
        title: '1. Add blocks',
        subtitle: 'Drag blocks from the left palette onto the canvas.',
        body: [
          ['list', '#a78bfa', '👉 Start with:', [
            { icon: '📌', text: 'Version' },
            { icon: '🤖', text: 'Bot — don’t forget the token' },
            { icon: '▶', text: 'Start' },
          ]],
          ['p', 'Each block is its own step. Some configure the bot (Version, Bot) and others handle events (Start, Command, On button).'],
          ['card', '🔍', [['text', 'Use search in the block library to find what you need faster.']]],
        ],
      },
      {
        id: 'connect',
        emoji: '🔗',
        color: '#34d399',
        glow: 'rgba(52,211,153,0.2)',
        label: 'Wiring',
        title: '2. Connect blocks',
        subtitle: 'Chain them top to bottom — like LEGO.',
        body: [
          ['p', 'Order in the stack is your bot logic: the top block is the trigger, blocks below are what happens next.'],
          ['example', [
            { icon: '▶', color: '#3ecf8e', text: 'Start' },
            { icon: '✉', color: '#5b7cf6', text: 'Reply → Hi!' },
            { icon: '⊞', color: '#a78bfa', text: 'Buttons → [Menu] [Help]' },
          ]],
          ['card', '⚡', [['text', 'Inside one stack blocks run in order from top to bottom.']]],
        ],
      },
      {
        id: 'settings',
        emoji: '✏️',
        color: '#60a5fa',
        glow: 'rgba(96,165,250,0.2)',
        label: 'Settings',
        title: '3. Configure a block',
        subtitle: 'Click a block and edit its fields.',
        body: [
          ['list', '#60a5fa', 'You can set:', [
            { icon: '📝', text: 'Message text' },
            { icon: '⌨', text: 'Command (e.g. /help)' },
            { icon: '📦', text: 'Variables {{name}}' },
          ]],
          ['card', '💡', [
            ['text', 'Use '],
            ['code', '{{name}}'],
            ['text', ' inside text to insert dynamic values.'],
          ]],
        ],
      },
      {
        id: 'logic',
        emoji: '⚡',
        color: '#fb923c',
        glow: 'rgba(251,146,60,0.2)',
        label: 'Logic',
        title: '4. Add logic',
        subtitle: 'Branches, waits, variables.',
        body: [
          ['list', '#fb923c', 'Logic blocks:', [
            { icon: '🔀', text: 'If — conditional branch' },
            { icon: '❓', text: 'Ask — wait for user input' },
            { icon: '💾', text: 'Save — persist a value' },
            { icon: '⏱', text: 'Delay — pause for seconds' },
          ]],
          ['card', '🎯', [['text', 'Variables keep their values across the steps of one flow.']]],
        ],
      },
      {
        id: 'run',
        emoji: '▶',
        color: '#3ecf8e',
        glow: 'rgba(62,207,142,0.2)',
        label: 'Run',
        title: '5. Run the bot',
        subtitle: 'Validate, generate, download the .ccd file.',
        body: [
          ['list', '#3ecf8e', 'Steps:', [
            { icon: '1️⃣', text: 'Run checks (✔ Check button)' },
            { icon: '2️⃣', text: 'Press Generate' },
            { icon: '3️⃣', text: 'Download .ccd with ↓' },
            { icon: '4️⃣', text: 'Run: cicada bot.ccd' },
          ]],
          ['codeblock', [
            { c: '#94a3b8', t: '# Install' },
            { c: '#e2e8f0', t: 'pip install cicada-tg' },
            { c: '#94a3b8', t: '# Run' },
            { c: '#3ecf8e', t: 'cicada bot.ccd' },
          ]],
        ],
      },
      {
        id: 'install',
        emoji: '🖥️',
        color: '#38bdf8',
        glow: 'rgba(56,189,248,0.2)',
        label: 'Install',
        title: '6. Install on your PC',
        subtitle: 'Python 3.10+ and pip are enough.',
        body: [
          ['list', '#38bdf8', 'Requirements:', [
            { icon: '🐍', text: 'Python 3.10+ (python.org)' },
            { icon: '📦', text: 'pip (bundled with Python)' },
            { icon: '🤖', text: 'Telegram bot token from @BotFather' },
          ]],
          ['pStyled', { color: '#38bdf8', fontSize: 12, marginBottom: 6 }, '🪟 Windows (cmd / PowerShell):'],
          ['codeblock', [{ c: '#e2e8f0', t: 'pip install cicada-tg' }]],
          ['pStyled', { color: '#38bdf8', fontSize: 12, marginBottom: 6 }, '🐧 Linux / macOS:'],
          ['codeblock', [{ c: '#e2e8f0', t: 'pip install cicada-tg --break-system-packages' }]],
          ['card', '⚠️', [['text', 'On Windows enable «Add Python to PATH» when installing Python.']]],
        ],
      },
      {
        id: 'tips',
        emoji: '⭐',
        color: '#f472b6',
        glow: 'rgba(244,114,182,0.2)',
        label: 'Must-know',
        title: '7. Important rules',
        subtitle: 'Without these the bot will not run.',
        body: [
          ['list', '#ef4444', '⚠️ Required:', [
            { icon: '🔗', text: 'Blocks must be connected in one stack' },
            { icon: '▶', text: 'There must be a Start block' },
            { icon: '🤖', text: 'Bot block needs a token' },
          ]],
          ['pStyled', { textAlign: 'center', color: '#ffd700', fontSize: 16, marginTop: 20 }, '🎉 You’re set — go build your bot!'],
        ],
      },
    ],
  };
}

function uk() {
  return {
    headerPrefix: 'Інструкція',
    back: '← Назад',
    next: 'Далі →',
    done: '✓ Зрозуміло!',
    exampleLabel: 'Приклад:',
    sections: [
      {
        id: 'intro',
        emoji: '🚀',
        color: '#ffd700',
        glow: 'rgba(255,215,0,0.2)',
        label: 'Початок',
        title: 'Як користуватися Cicada Studio',
        subtitle: 'Збирай Telegram-бота як із пазлів 🧩',
        body: [
          ['p', 'Cicada Studio — візуальний конструктор Telegram-ботів. Замість коду ти працюєш з блоками: перетягуєш їх на полотно, з’єднуєш і запускаєш бота одним кліком.'],
          ['card', '💡', [
            ['text', 'Почни з блоків '],
            ['code', 'Версія'],
            ['text', ' → '],
            ['code', 'Бот'],
            ['text', ' → '],
            ['code', 'Старт'],
            ['text', ' — це мінімальний робочий бот.'],
          ]],
        ],
      },
      {
        id: 'blocks',
        emoji: '🧩',
        color: '#a78bfa',
        glow: 'rgba(167,139,250,0.2)',
        label: 'Блоки',
        title: '1. Додай блоки',
        subtitle: 'Перетягни блоки з лівої панелі на полотно.',
        body: [
          ['list', '#a78bfa', '👉 Почни з:', [
            { icon: '📌', text: 'Версія' },
            { icon: '🤖', text: 'Бот — обов’язково вкажи токен' },
            { icon: '▶', text: 'Старт' },
          ]],
          ['p', 'Кожен блок — окрема інструкція. Є налаштувальні (версія, бот) і подійні (старт, команда, при натисканні).'],
          ['card', '🔍', [['text', 'Використовуй пошук у бібліотеці блоків, щоб швидко знайти потрібний.']]],
        ],
      },
      {
        id: 'connect',
        emoji: '🔗',
        color: '#34d399',
        glow: 'rgba(52,211,153,0.2)',
        label: "З'єднання",
        title: "2. З'єднуй блоки",
        subtitle: 'Зверху вниз — як конструктор.',
        body: [
          ['p', 'Порядок блоків у стеку задає логіку бота. Верхній блок — тригер, нижчі — реакції.'],
          ['example', [
            { icon: '▶', color: '#3ecf8e', text: 'Старт' },
            { icon: '✉', color: '#5b7cf6', text: 'Відповідь → Привіт!' },
            { icon: '⊞', color: '#a78bfa', text: 'Кнопки → [Меню] [Допомога]' },
          ]],
          ['card', '⚡', [['text', 'Блоки в одному стеку виконуються послідовно зверху вниз.']]],
        ],
      },
      {
        id: 'settings',
        emoji: '✏️',
        color: '#60a5fa',
        glow: 'rgba(96,165,250,0.2)',
        label: 'Налаштування',
        title: '3. Налаштуй блок',
        subtitle: 'Натисни блок і задай параметри.',
        body: [
          ['list', '#60a5fa', 'Що можна задати:', [
            { icon: '📝', text: 'Текст повідомлення' },
            { icon: '⌨', text: 'Команду (наприклад /help)' },
            { icon: '📦', text: 'Змінні {{ім’я}}' },
          ]],
          ['card', '💡', [
            ['text', 'Використовуй змінну '],
            ['code', '{{ім’я}}'],
            ['text', ' у тексті для підстановки даних.'],
          ]],
        ],
      },
      {
        id: 'logic',
        emoji: '⚡',
        color: '#fb923c',
        glow: 'rgba(251,146,60,0.2)',
        label: 'Логіка',
        title: '4. Додай логіку',
        subtitle: 'Гілки, цикли й змінні.',
        body: [
          ['list', '#fb923c', 'Блоки логіки:', [
            { icon: '🔀', text: 'Якщо — перевірка умови' },
            { icon: '❓', text: 'Запитати — ввід від користувача' },
            { icon: '💾', text: 'Зберегти — запис у пам’ять' },
            { icon: '⏱', text: 'Затримка — пауза в секундах' },
          ]],
          ['card', '🎯', [['text', 'Значення змінних зберігаються між кроками одного сценарію.']]],
        ],
      },
      {
        id: 'run',
        emoji: '▶',
        color: '#3ecf8e',
        glow: 'rgba(62,207,142,0.2)',
        label: 'Запуск',
        title: '5. Запусти бота',
        subtitle: 'Перевір, згенеруй і завантаж файл .ccd.',
        body: [
          ['list', '#3ecf8e', 'Кроки:', [
            { icon: '1️⃣', text: 'Перевір помилки (кнопка ✔ Перевірити)' },
            { icon: '2️⃣', text: 'Натисни «Згенерувати»' },
            { icon: '3️⃣', text: 'Завантаж .ccd кнопкою ↓' },
            { icon: '4️⃣', text: 'Запуск: cicada bot.ccd' },
          ]],
          ['codeblock', [
            { c: '#94a3b8', t: '# Встановлення' },
            { c: '#e2e8f0', t: 'pip install cicada-tg' },
            { c: '#94a3b8', t: '# Запуск' },
            { c: '#3ecf8e', t: 'cicada bot.ccd' },
          ]],
        ],
      },
      {
        id: 'install',
        emoji: '🖥️',
        color: '#38bdf8',
        glow: 'rgba(56,189,248,0.2)',
        label: 'Встановлення',
        title: '6. Встановлення на ПК',
        subtitle: 'Python 3.10+ і pip — цього достатньо.',
        body: [
          ['list', '#38bdf8', 'Вимоги:', [
            { icon: '🐍', text: 'Python 3.10+ (python.org)' },
            { icon: '📦', text: 'pip (разом із Python)' },
            { icon: '🤖', text: 'Токен бота від @BotFather' },
          ]],
          ['pStyled', { color: '#38bdf8', fontSize: 12, marginBottom: 6 }, '🪟 Windows (cmd / PowerShell):'],
          ['codeblock', [{ c: '#e2e8f0', t: 'pip install cicada-tg' }]],
          ['pStyled', { color: '#38bdf8', fontSize: 12, marginBottom: 6 }, '🐧 Linux / macOS:'],
          ['codeblock', [{ c: '#e2e8f0', t: 'pip install cicada-tg --break-system-packages' }]],
          ['card', '⚠️', [['text', 'У Windows під час встановлення Python увімкни «Add Python to PATH».']]],
        ],
      },
      {
        id: 'tips',
        emoji: '⭐',
        color: '#f472b6',
        glow: 'rgba(244,114,182,0.2)',
        label: 'Важливо',
        title: '7. Важливі правила',
        subtitle: 'Без цього бот не запуститься.',
        body: [
          ['list', '#ef4444', '⚠️ Обов’язково:', [
            { icon: '🔗', text: 'Блоки мають бути з’єднані в стек' },
            { icon: '▶', text: 'Має бути блок Старт' },
            { icon: '🤖', text: 'У блоці Бот потрібен токен' },
          ]],
          ['pStyled', { textAlign: 'center', color: '#ffd700', fontSize: 16, marginTop: 20 }, '🎉 Готово! Збирай свого бота!'],
        ],
      },
    ],
  };
}

const GUIDE_UPDATES = {
  ru: {
    replacements: {
      intro: {
        title: 'Полная карта Cicada Studio',
        subtitle: 'От первого блока до сценариев, БД, медиа и интеграций.',
        body: [
          ['p', 'Cicada Studio собирает Telegram-бота из блоков и генерирует .ccd для ядра Cicada. Визуальная схема остаётся простой, но за ней доступны сценарии, хранилище, медиа, Telegram-события, HTTP, БД, платежи и аналитика.'],
          ['card', '💡', [
            ['text', 'Минимальный бот: '],
            ['code', 'Версия'],
            ['text', ' → '],
            ['code', 'Бот'],
            ['text', ' → '],
            ['code', 'Старт'],
            ['text', ' → '],
            ['code', 'Ответ'],
            ['text', '. Дальше добавляй кнопки, условия и сценарии.'],
          ]],
          ['card', '🧠', [['text', 'Ядро понимает русскоязычный DSL: '], ['code', 'при старте:'], ['text', ', '], ['code', 'спросить'], ['text', ', '], ['code', 'сохранить'], ['text', ', '], ['code', 'запустить'], ['text', ', '], ['code', 'проверить подписку'], ['text', ' и другие инструкции.']]],
        ],
      },
      blocks: {
        title: '1. Выбери блоки',
        subtitle: 'Палитра разделена по назначению: настройки, события, логика, данные, медиа.',
        body: [
          ['list', '#a78bfa', 'Основные группы:', [
            { icon: '⚙', text: 'Настройки: версия, токен, команды меню, глобальные переменные' },
            { icon: '▶', text: 'События: старт, команда, нажатие, текст, фото, голос, документ' },
            { icon: '🧠', text: 'Логика: если, иначе, переключатель, вопрос, цикл, рандом' },
            { icon: '🗄', text: 'Данные и интеграции: KV, SQL, HTTP, уведомления, рассылки' },
          ]],
          ['p', 'Каждый блок генерирует одну или несколько DSL-инструкций. Если блок можно вложить, Studio подсказывает допустимые соединения и не даёт собрать заведомо несовместимый стек.'],
          ['card', '🔍', [['text', 'Используй поиск в библиотеке блоков и готовые модули: там есть шаблоны авторизации, подписок, рефералок, магазинов и админ-панелей.']]],
        ],
      },
      connect: {
        title: '2. Соединяй стек сверху вниз',
        subtitle: 'Верхний блок запускает цепочку, нижние выполняются по порядку.',
        body: [
          ['p', 'Стек читается как сценарий: событие сверху, затем ответы, кнопки, проверки, сохранение данных и переходы. Для ветвлений у блока «Если» есть выходы true/false, у «Цикла» — body/done.'],
          ['example', [
            { icon: '▶', color: '#3ecf8e', text: 'Старт' },
            { icon: '✉', color: '#5b7cf6', text: 'Ответ → Привет, {пользователь.имя}!' },
            { icon: '▦', color: '#a78bfa', text: 'Inline-кнопки → Каталог | cart' },
            { icon: '⊙', color: '#60a5fa', text: 'При нажатии "cart"' },
          ]],
          ['card', '⚡', [['text', 'Кнопки, inline-кнопки и медиа можно прикреплять к сообщениям как UI-элементы, а можно ставить отдельными блоками.']]],
        ],
      },
      settings: {
        title: '3. Настрой данные блока',
        subtitle: 'Поля блока превращаются в параметры DSL.',
        body: [
          ['list', '#60a5fa', 'Что чаще всего заполняют:', [
            { icon: '📝', text: 'Текст ответа, Markdown-ответы и подписи к медиа' },
            { icon: '⌨', text: 'Команды /start, /help и callback-метки кнопок' },
            { icon: '📦', text: 'Переменные: {текст}, {пользователь.id}, {пользователь.имя}, свои значения' },
            { icon: '🔐', text: 'Ключи хранилища, ID пользователей, каналы, роли и токены' },
          ]],
          ['card', '💡', [['text', 'В тексте используй подстановки в фигурных скобках, например '], ['code', '{пользователь.имя}'], ['text', ' или сохранённую переменную '], ['code', '{имя}'], ['text', '.']]],
        ],
      },
      logic: {
        title: '4. Добавь логику',
        subtitle: 'Ветвления, циклы, ввод пользователя и переиспользуемые блоки.',
        body: [
          ['list', '#fb923c', 'Поддерживается:', [
            { icon: '🔀', text: 'Если / иначе и переключатель по значению переменной' },
            { icon: '❓', text: 'Спросить → сохранить ответ пользователя в переменную' },
            { icon: '↻', text: 'Циклы: повторять N раз, пока условие, для каждого, таймаут' },
            { icon: '🧱', text: 'Блок / использовать / вызвать блок → результат' },
          ]],
          ['codeblock', [
            { c: '#94a3b8', t: '# Пример логики' },
            { c: '#e2e8f0', t: 'спросить "Как вас зовут?" → имя' },
            { c: '#e2e8f0', t: 'если имя содержит "admin":' },
            { c: '#3ecf8e', t: '    ответ "Открываю админ-панель"' },
          ]],
          ['card', '🎯', [['text', 'Для длинных диалогов выноси этапы в '], ['code', 'сценарий'], ['text', ' и '], ['code', 'шаг'], ['text', ': так проще управлять переходами.']]],
        ],
      },
      run: {
        label: 'Запуск',
        title: '9. Проверь и запусти',
        subtitle: 'Проверка знает новые инструкции и подсвечивает ошибки до запуска.',
        body: [
          ['list', '#3ecf8e', 'Рабочий порядок:', [
            { icon: '1', text: 'Нажми «Проверить» — Studio проверит DSL, пустые блоки и опасные связки' },
            { icon: '2', text: 'Нажми «Генерировать» и посмотри итоговый .ccd' },
            { icon: '3', text: 'Скачай .ccd или сохрани проект в облако' },
            { icon: '4', text: 'Запусти файл тем же ядром, под которое собрана Studio' },
          ]],
          ['codeblock', [
            { c: '#94a3b8', t: '# Рекомендуемая версия ядра' },
            { c: '#e2e8f0', t: 'pip install cicada-tg==0.3.5' },
            { c: '#94a3b8', t: '# Запуск' },
            { c: '#3ecf8e', t: 'cicada bot.ccd' },
          ]],
        ],
      },
      install: {
        label: 'Установка',
        title: '10. Установка на ПК',
        subtitle: 'Python 3.10+ и актуальное ядро Cicada.',
        body: [
          ['list', '#38bdf8', 'Требования:', [
            { icon: '🐍', text: 'Python 3.10+ с включённым PATH' },
            { icon: '📦', text: 'pip для установки cicada-tg==0.3.5' },
            { icon: '🤖', text: 'Telegram Bot Token от @BotFather' },
            { icon: '🌐', text: 'Доступ к API/БД, если используешь HTTP, SQL, платежи или рассылки' },
          ]],
          ['pStyled', { color: '#38bdf8', fontSize: 12, marginBottom: 6 }, 'Windows / Linux / macOS:'],
          ['codeblock', [{ c: '#e2e8f0', t: 'pip install cicada-tg==0.3.5' }]],
          ['card', '⚠️', [['text', 'На системном Linux может понадобиться виртуальное окружение или флаг '], ['code', '--break-system-packages'], ['text', '.']]],
        ],
      },
      tips: {
        label: 'Правила',
        title: '11. Важные правила',
        subtitle: 'Эти правила помогают избежать неожиданных остановок сценария.',
        body: [
          ['list', '#ef4444', 'Проверяй перед запуском:', [
            { icon: '🔗', text: 'У корневого события должен быть связанный стек действий' },
            { icon: '🤖', text: 'В блоке Бот нужен реальный токен, а не плейсхолдер' },
            { icon: '🧭', text: 'После «запустить сценарий» не ставь сразу «стоп» в том же обработчике' },
            { icon: '»', text: 'Шаги сценария идут по порядку; переход нужен только для ветвления' },
          ]],
          ['card', '🛡', [['text', 'Studio остаётся тонким редактором: она генерирует DSL и подсказки, а поведение выполнения определяет ядро Cicada.']]],
          ['pStyled', { textAlign: 'center', color: '#ffd700', fontSize: 16, marginTop: 20 }, 'Готово! Теперь можно собирать сложного Telegram-бота без ручного кода.'],
        ],
      },
    },
    inserts: [
      {
        after: 'logic',
        section: {
          id: 'events',
          emoji: '📡',
          color: '#22d3ee',
          glow: 'rgba(34,211,238,0.2)',
          label: 'События',
          title: '5. Обрабатывай разные входы',
          subtitle: 'Бот может реагировать не только на /start и кнопки.',
          body: [
            ['list', '#22d3ee', 'Корневые события:', [
              { icon: '💬', text: 'Текст и команды: при тексте, при команде, при нажатии' },
              { icon: '🖼', text: 'Медиа: при фото, документе, голосовом, стикере' },
              { icon: '📍', text: 'Данные Telegram: при локации и контакте' },
              { icon: '⚙', text: 'Middleware: до каждого / после каждого сообщения' },
            ]],
            ['card', '📎', [['text', 'Для входящих файлов используй '], ['code', 'запомни файл → переменная'], ['text', ', а затем отправляй или пересылай сохранённый file_id.']]],
          ],
        },
      },
      {
        after: 'events',
        section: {
          id: 'media',
          emoji: '🖼',
          color: '#34d399',
          glow: 'rgba(52,211,153,0.2)',
          label: 'Медиа',
          title: '6. Отправляй медиа и интерфейс',
          subtitle: 'Фото, видео, документы, контакты, локации, опросы и клавиатуры.',
          body: [
            ['list', '#34d399', 'Что доступно:', [
              { icon: '🖼', text: 'Фото, видео, аудио, документ, стикер, отправить файл' },
              { icon: '👤', text: 'Контакт, локация и опрос Telegram' },
              { icon: '⊞', text: 'Reply-кнопки, inline-кнопки и inline из БД' },
              { icon: '≡', text: 'Меню для простых навигационных разделов' },
            ]],
            ['codeblock', [
              { c: '#e2e8f0', t: 'фото "https://site/image.jpg"' },
              { c: '#e2e8f0', t: 'опрос "Выберите тариф"' },
              { c: '#3ecf8e', t: '    - "Basic"' },
              { c: '#3ecf8e', t: '    - "Pro"' },
            ]],
          ],
        },
      },
      {
        after: 'media',
        section: {
          id: 'data',
          emoji: '🗄',
          color: '#10b981',
          glow: 'rgba(16,185,129,0.2)',
          label: 'Данные',
          title: '7. Храни данные и подключай сервисы',
          subtitle: 'KV-хранилище, глобальные значения, SQL, HTTP и AI-классификация.',
          body: [
            ['list', '#10b981', 'Новые рабочие возможности:', [
              { icon: '💾', text: 'Сохранить / получить / удалить ключ текущего пользователя' },
              { icon: '🌐', text: 'Глобальная БД и чтение данных другого пользователя по ID' },
              { icon: '↗', text: 'HTTP GET/POST/PUT/PATCH/DELETE с сохранением ответа' },
              { icon: '🧠', text: 'Классификация текста, события аналитики и платежи' },
            ]],
            ['codeblock', [
              { c: '#e2e8f0', t: 'запрос GET "https://api.example.com" → ответ' },
              { c: '#e2e8f0', t: 'запрос_бд "select * from users" → rows' },
              { c: '#e2e8f0', t: 'классифицировать ["заказ", "вопрос"] → намерение' },
            ]],
          ],
        },
      },
      {
        after: 'data',
        section: {
          id: 'telegram',
          emoji: '✅',
          color: '#60a5fa',
          glow: 'rgba(96,165,250,0.2)',
          label: 'Telegram',
          title: '8. Используй Telegram-возможности',
          subtitle: 'Подписки, роли, пересылка, уведомления и рассылки.',
          body: [
            ['list', '#60a5fa', 'Полезные блоки:', [
              { icon: '✅', text: 'Проверка подписки на канал перед доступом к боту' },
              { icon: '👮', text: 'Получение роли участника группы или канала' },
              { icon: '↗', text: 'Переслать входящее фото, текст, документ, голосовое или стикер' },
              { icon: '📡', text: 'Рассылка всем пользователям или группе по тегу' },
            ]],
            ['card', '🔐', [['text', 'Для админок комбинируй '], ['code', 'проверить подписку'], ['text', ', '], ['code', 'роль'], ['text', ', хранилище и условия.']]],
          ],
        },
      },
    ],
  },
  en: {
    replacements: {
      intro: {
        title: 'Cicada Studio Feature Map',
        subtitle: 'From the first block to flows, storage, media, and integrations.',
        body: [
          ['p', 'Cicada Studio builds a Telegram bot from blocks and generates .ccd for the Cicada core. The canvas stays visual, while the core supports scenarios, storage, media, Telegram events, HTTP, SQL, payments, and analytics.'],
          ['card', '💡', [['text', 'Smallest bot: '], ['code', 'Version'], ['text', ' → '], ['code', 'Bot'], ['text', ' → '], ['code', 'Start'], ['text', ' → '], ['code', 'Reply'], ['text', '. Then add buttons, conditions, and scenarios.']]],
          ['card', '🧠', [['text', 'The generated DSL uses Russian core keywords such as '], ['code', 'при старте:'], ['text', ', '], ['code', 'спросить'], ['text', ', '], ['code', 'сохранить'], ['text', ', '], ['code', 'запустить'], ['text', ', and Telegram checks.']]],
        ],
      },
      blocks: {
        title: '1. Pick blocks',
        subtitle: 'The palette is grouped by settings, events, logic, data, and media.',
        body: [
          ['list', '#a78bfa', 'Main groups:', [
            { icon: '⚙', text: 'Settings: version, token, menu commands, globals' },
            { icon: '▶', text: 'Events: start, command, click, text, photo, voice, document' },
            { icon: '🧠', text: 'Logic: if, else, switch, ask, loop, random' },
            { icon: '🗄', text: 'Data and integrations: KV, SQL, HTTP, notifications, broadcasts' },
          ]],
          ['p', 'Each block emits one or more DSL instructions. Studio also knows which blocks can be stacked together and guides valid connections.'],
          ['card', '🔍', [['text', 'Use block search and the module library for auth, subscriptions, referrals, shops, and admin panels.']]],
        ],
      },
      connect: {
        title: '2. Chain top to bottom',
        subtitle: 'The top block starts the chain; blocks below run in order.',
        body: [
          ['p', 'A stack reads like a flow: event first, then replies, buttons, checks, storage, and jumps. If has true/false outputs, Loop has body/done outputs.'],
          ['example', [
            { icon: '▶', color: '#3ecf8e', text: 'Start' },
            { icon: '✉', color: '#5b7cf6', text: 'Reply → Hi, {user.name}!' },
            { icon: '▦', color: '#a78bfa', text: 'Inline buttons → Catalog | cart' },
            { icon: '⊙', color: '#60a5fa', text: 'On click "cart"' },
          ]],
          ['card', '⚡', [['text', 'Buttons, inline buttons, and media can be attached to messages as UI elements or placed as separate blocks.']]],
        ],
      },
      settings: {
        title: '3. Configure block fields',
        subtitle: 'Block fields become DSL parameters.',
        body: [
          ['list', '#60a5fa', 'Common fields:', [
            { icon: '📝', text: 'Reply text, Markdown replies, and media captions' },
            { icon: '⌨', text: 'Commands like /start, /help, and callback labels' },
            { icon: '📦', text: 'Variables: {text}, {user.id}, {user.name}, and custom values' },
            { icon: '🔐', text: 'Storage keys, user IDs, channels, roles, and tokens' },
          ]],
          ['card', '💡', [['text', 'Use curly braces in text, for example '], ['code', '{user.name}'], ['text', ' or your saved variable '], ['code', '{name}'], ['text', '.']]],
        ],
      },
      logic: {
        title: '4. Add logic',
        subtitle: 'Branches, loops, user input, and reusable blocks.',
        body: [
          ['list', '#fb923c', 'Supported:', [
            { icon: '🔀', text: 'If / else and switch by variable value' },
            { icon: '❓', text: 'Ask → store the user answer in a variable' },
            { icon: '↻', text: 'Loops: repeat N times, while, for each, timeout' },
            { icon: '🧱', text: 'Block / use / call block → result' },
          ]],
          ['codeblock', [
            { c: '#94a3b8', t: '# Logic example' },
            { c: '#e2e8f0', t: 'спросить "What is your name?" → name' },
            { c: '#e2e8f0', t: 'если name содержит "admin":' },
            { c: '#3ecf8e', t: '    ответ "Opening admin panel"' },
          ]],
          ['card', '🎯', [['text', 'For long dialogs, split the flow into '], ['code', 'scenario'], ['text', ' and '], ['code', 'step'], ['text', ' blocks.']]],
        ],
      },
      run: {
        label: 'Run',
        title: '9. Check and run',
        subtitle: 'Validation understands the newer instructions before runtime.',
        body: [
          ['list', '#3ecf8e', 'Workflow:', [
            { icon: '1', text: 'Click Check to validate DSL, empty blocks, and risky chains' },
            { icon: '2', text: 'Click Generate and inspect the final .ccd' },
            { icon: '3', text: 'Download .ccd or save the project to cloud' },
            { icon: '4', text: 'Run it with the same core version Studio targets' },
          ]],
          ['codeblock', [
            { c: '#94a3b8', t: '# Recommended core version' },
            { c: '#e2e8f0', t: 'pip install cicada-tg==0.3.5' },
            { c: '#94a3b8', t: '# Run' },
            { c: '#3ecf8e', t: 'cicada bot.ccd' },
          ]],
        ],
      },
      install: {
        label: 'Install',
        title: '10. Install locally',
        subtitle: 'Python 3.10+ and the matching Cicada core.',
        body: [
          ['list', '#38bdf8', 'Requirements:', [
            { icon: '🐍', text: 'Python 3.10+ with PATH configured' },
            { icon: '📦', text: 'pip to install cicada-tg==0.3.5' },
            { icon: '🤖', text: 'Telegram bot token from @BotFather' },
            { icon: '🌐', text: 'API/DB access if you use HTTP, SQL, payments, or broadcasts' },
          ]],
          ['pStyled', { color: '#38bdf8', fontSize: 12, marginBottom: 6 }, 'Windows / Linux / macOS:'],
          ['codeblock', [{ c: '#e2e8f0', t: 'pip install cicada-tg==0.3.5' }]],
          ['card', '⚠️', [['text', 'On system Python under Linux, use a virtual environment or '], ['code', '--break-system-packages'], ['text', ' if you know what you are doing.']]],
        ],
      },
      tips: {
        label: 'Rules',
        title: '11. Important rules',
        subtitle: 'These rules prevent unexpected scenario stops.',
        body: [
          ['list', '#ef4444', 'Before running:', [
            { icon: '🔗', text: 'Every root event should have a connected action stack' },
            { icon: '🤖', text: 'The Bot block needs a real token, not a placeholder' },
            { icon: '🧭', text: 'Do not put Stop immediately after Run scenario in the same handler' },
            { icon: '»', text: 'Scenario steps run in order; use jumps only for branches' },
          ]],
          ['card', '🛡', [['text', 'Studio is a thin editor: it generates DSL and hints, while runtime behavior belongs to the Cicada core.']]],
          ['pStyled', { textAlign: 'center', color: '#ffd700', fontSize: 16, marginTop: 20 }, 'You are ready to build a full Telegram bot without writing code by hand.'],
        ],
      },
    },
    inserts: [
      {
        after: 'logic',
        section: {
          id: 'events',
          emoji: '📡',
          color: '#22d3ee',
          glow: 'rgba(34,211,238,0.2)',
          label: 'Events',
          title: '5. Handle different inputs',
          subtitle: 'The bot can react to more than /start and buttons.',
          body: [
            ['list', '#22d3ee', 'Root events:', [
              { icon: '💬', text: 'Text and commands: on text, command, button click' },
              { icon: '🖼', text: 'Media: photo, document, voice, sticker' },
              { icon: '📍', text: 'Telegram data: location and contact' },
              { icon: '⚙', text: 'Middleware: before each / after each message' },
            ]],
            ['card', '📎', [['text', 'For incoming files, store the file first and then send or forward the saved file_id.']]],
          ],
        },
      },
      {
        after: 'events',
        section: {
          id: 'media',
          emoji: '🖼',
          color: '#34d399',
          glow: 'rgba(52,211,153,0.2)',
          label: 'Media',
          title: '6. Send media and UI',
          subtitle: 'Photos, videos, documents, contacts, locations, polls, and keyboards.',
          body: [
            ['list', '#34d399', 'Available:', [
              { icon: '🖼', text: 'Photo, video, audio, document, sticker, send file' },
              { icon: '👤', text: 'Contact, location, and Telegram poll' },
              { icon: '⊞', text: 'Reply buttons, inline buttons, and inline from DB' },
              { icon: '≡', text: 'Menu for simple navigation sections' },
            ]],
            ['codeblock', [
              { c: '#e2e8f0', t: 'photo "https://site/image.jpg"' },
              { c: '#e2e8f0', t: 'poll "Choose a plan"' },
              { c: '#3ecf8e', t: '    - "Basic"' },
              { c: '#3ecf8e', t: '    - "Pro"' },
            ]],
          ],
        },
      },
      {
        after: 'media',
        section: {
          id: 'data',
          emoji: '🗄',
          color: '#10b981',
          glow: 'rgba(16,185,129,0.2)',
          label: 'Data',
          title: '7. Store data and connect services',
          subtitle: 'KV storage, globals, SQL, HTTP, and classification.',
          body: [
            ['list', '#10b981', 'Core features:', [
              { icon: '💾', text: 'Save / get / delete a key for the current user' },
              { icon: '🌐', text: 'Global DB and reading another user value by ID' },
              { icon: '↗', text: 'HTTP GET/POST/PUT/PATCH/DELETE with response storage' },
              { icon: '🧠', text: 'Text classification, analytics events, and payments' },
            ]],
            ['codeblock', [
              { c: '#e2e8f0', t: 'запрос GET "https://api.example.com" → response' },
              { c: '#e2e8f0', t: 'запрос_бд "select * from users" → rows' },
              { c: '#e2e8f0', t: 'классифицировать ["order", "question"] → intent' },
            ]],
          ],
        },
      },
      {
        after: 'data',
        section: {
          id: 'telegram',
          emoji: '✅',
          color: '#60a5fa',
          glow: 'rgba(96,165,250,0.2)',
          label: 'Telegram',
          title: '8. Use Telegram features',
          subtitle: 'Subscriptions, roles, forwarding, notifications, and broadcasts.',
          body: [
            ['list', '#60a5fa', 'Useful blocks:', [
              { icon: '✅', text: 'Check channel subscription before granting access' },
              { icon: '👮', text: 'Read a member role in a group or channel' },
              { icon: '↗', text: 'Forward incoming photo, text, document, voice, or sticker' },
              { icon: '📡', text: 'Broadcast to all users or a tagged group' },
            ]],
            ['card', '🔐', [['text', 'For admin bots, combine subscription checks, roles, storage, and conditions.']]],
          ],
        },
      },
    ],
  },
  uk: {
    replacements: {
      intro: {
        title: 'Повна карта Cicada Studio',
        subtitle: 'Від першого блока до сценаріїв, БД, медіа та інтеграцій.',
        body: [
          ['p', 'Cicada Studio збирає Telegram-бота з блоків і генерує .ccd для ядра Cicada. Схема лишається візуальною, але доступні сценарії, сховище, медіа, Telegram-події, HTTP, БД, платежі й аналітика.'],
          ['card', '💡', [['text', 'Мінімальний бот: '], ['code', 'Версія'], ['text', ' → '], ['code', 'Бот'], ['text', ' → '], ['code', 'Старт'], ['text', ' → '], ['code', 'Відповідь'], ['text', '. Далі додавай кнопки, умови та сценарії.']]],
          ['card', '🧠', [['text', 'Ядро розуміє DSL-інструкції на кшталт '], ['code', 'при старте:'], ['text', ', '], ['code', 'спросить'], ['text', ', '], ['code', 'сохранить'], ['text', ', '], ['code', 'запустить'], ['text', ' і Telegram-перевірки.']]],
        ],
      },
      blocks: {
        title: '1. Обери блоки',
        subtitle: 'Палітра поділена на налаштування, події, логіку, дані та медіа.',
        body: [
          ['list', '#a78bfa', 'Основні групи:', [
            { icon: '⚙', text: 'Налаштування: версія, токен, команди меню, глобальні змінні' },
            { icon: '▶', text: 'Події: старт, команда, натискання, текст, фото, голос, документ' },
            { icon: '🧠', text: 'Логіка: якщо, інакше, перемикач, питання, цикл, рандом' },
            { icon: '🗄', text: 'Дані та інтеграції: KV, SQL, HTTP, сповіщення, розсилки' },
          ]],
          ['p', 'Кожен блок генерує одну або кілька DSL-інструкцій. Studio підказує допустимі з’єднання й не дає зібрати явно несумісний стек.'],
          ['card', '🔍', [['text', 'Користуйся пошуком блоків і бібліотекою модулів: там є шаблони авторизації, підписок, рефералок, магазинів та адмін-панелей.']]],
        ],
      },
      connect: {
        title: '2. З’єднуй стек зверху вниз',
        subtitle: 'Верхній блок запускає ланцюжок, нижчі виконуються по порядку.',
        body: [
          ['p', 'Стек читається як сценарій: подія зверху, потім відповіді, кнопки, перевірки, збереження даних і переходи. У «Якщо» є виходи true/false, у «Циклу» — body/done.'],
          ['example', [
            { icon: '▶', color: '#3ecf8e', text: 'Старт' },
            { icon: '✉', color: '#5b7cf6', text: 'Відповідь → Привіт, {пользователь.имя}!' },
            { icon: '▦', color: '#a78bfa', text: 'Inline-кнопки → Каталог | cart' },
            { icon: '⊙', color: '#60a5fa', text: 'При натисканні "cart"' },
          ]],
          ['card', '⚡', [['text', 'Кнопки, inline-кнопки та медіа можна прикріплювати до повідомлень як UI-елементи або ставити окремими блоками.']]],
        ],
      },
      settings: {
        title: '3. Налаштуй поля блока',
        subtitle: 'Поля блока стають параметрами DSL.',
        body: [
          ['list', '#60a5fa', 'Найчастіші поля:', [
            { icon: '📝', text: 'Текст відповіді, Markdown-відповіді й підписи до медіа' },
            { icon: '⌨', text: 'Команди /start, /help і callback-мітки кнопок' },
            { icon: '📦', text: 'Змінні: {текст}, {пользователь.id}, {пользователь.имя}, власні значення' },
            { icon: '🔐', text: 'Ключі сховища, ID користувачів, канали, ролі й токени' },
          ]],
          ['card', '💡', [['text', 'У тексті використовуй підстановки у фігурних дужках, наприклад '], ['code', '{пользователь.имя}'], ['text', ' або свою змінну '], ['code', '{ім’я}'], ['text', '.']]],
        ],
      },
      logic: {
        title: '4. Додай логіку',
        subtitle: 'Гілки, цикли, ввід користувача й повторне використання блоків.',
        body: [
          ['list', '#fb923c', 'Підтримується:', [
            { icon: '🔀', text: 'Якщо / інакше та перемикач за значенням змінної' },
            { icon: '❓', text: 'Запитати → зберегти відповідь користувача у змінну' },
            { icon: '↻', text: 'Цикли: повторити N разів, поки умова, для кожного, таймаут' },
            { icon: '🧱', text: 'Блок / використовувати / викликати блок → результат' },
          ]],
          ['codeblock', [
            { c: '#94a3b8', t: '# Приклад логіки' },
            { c: '#e2e8f0', t: 'спросить "Як вас звати?" → ім’я' },
            { c: '#e2e8f0', t: 'если ім’я содержит "admin":' },
            { c: '#3ecf8e', t: '    ответ "Відкриваю адмін-панель"' },
          ]],
          ['card', '🎯', [['text', 'Для довгих діалогів винось етапи в '], ['code', 'сценарий'], ['text', ' і '], ['code', 'шаг'], ['text', ': так легше керувати переходами.']]],
        ],
      },
      run: {
        label: 'Запуск',
        title: '9. Перевір і запусти',
        subtitle: 'Перевірка знає нові інструкції й показує помилки до запуску.',
        body: [
          ['list', '#3ecf8e', 'Робочий порядок:', [
            { icon: '1', text: 'Натисни «Перевірити» — Studio перевірить DSL, порожні блоки й ризикові зв’язки' },
            { icon: '2', text: 'Натисни «Згенерувати» і переглянь фінальний .ccd' },
            { icon: '3', text: 'Завантаж .ccd або збережи проєкт у хмару' },
            { icon: '4', text: 'Запусти файл тим самим ядром, під яке зібрана Studio' },
          ]],
          ['codeblock', [
            { c: '#94a3b8', t: '# Рекомендована версія ядра' },
            { c: '#e2e8f0', t: 'pip install cicada-tg==0.3.5' },
            { c: '#94a3b8', t: '# Запуск' },
            { c: '#3ecf8e', t: 'cicada bot.ccd' },
          ]],
        ],
      },
      install: {
        label: 'Встановлення',
        title: '10. Встановлення на ПК',
        subtitle: 'Python 3.10+ і актуальне ядро Cicada.',
        body: [
          ['list', '#38bdf8', 'Вимоги:', [
            { icon: '🐍', text: 'Python 3.10+ з увімкненим PATH' },
            { icon: '📦', text: 'pip для встановлення cicada-tg==0.3.5' },
            { icon: '🤖', text: 'Telegram Bot Token від @BotFather' },
            { icon: '🌐', text: 'Доступ до API/БД, якщо використовуєш HTTP, SQL, платежі або розсилки' },
          ]],
          ['pStyled', { color: '#38bdf8', fontSize: 12, marginBottom: 6 }, 'Windows / Linux / macOS:'],
          ['codeblock', [{ c: '#e2e8f0', t: 'pip install cicada-tg==0.3.5' }]],
          ['card', '⚠️', [['text', 'На системному Linux може знадобитися віртуальне оточення або прапорець '], ['code', '--break-system-packages'], ['text', '.']]],
        ],
      },
      tips: {
        label: 'Правила',
        title: '11. Важливі правила',
        subtitle: 'Ці правила допомагають уникнути несподіваних зупинок сценарію.',
        body: [
          ['list', '#ef4444', 'Перевіряй перед запуском:', [
            { icon: '🔗', text: 'У кореневої події має бути пов’язаний стек дій' },
            { icon: '🤖', text: 'У блоці Бот потрібен справжній токен, не плейсхолдер' },
            { icon: '🧭', text: 'Після «запустити сценарій» не став одразу «стоп» у тому ж обробнику' },
            { icon: '»', text: 'Кроки сценарію йдуть по порядку; перехід потрібен лише для гілок' },
          ]],
          ['card', '🛡', [['text', 'Studio лишається тонким редактором: вона генерує DSL і підказки, а поведінку виконання визначає ядро Cicada.']]],
          ['pStyled', { textAlign: 'center', color: '#ffd700', fontSize: 16, marginTop: 20 }, 'Готово! Тепер можна збирати складного Telegram-бота без ручного коду.'],
        ],
      },
    },
    inserts: [
      {
        after: 'logic',
        section: {
          id: 'events',
          emoji: '📡',
          color: '#22d3ee',
          glow: 'rgba(34,211,238,0.2)',
          label: 'Події',
          title: '5. Обробляй різні входи',
          subtitle: 'Бот може реагувати не лише на /start і кнопки.',
          body: [
            ['list', '#22d3ee', 'Кореневі події:', [
              { icon: '💬', text: 'Текст і команди: при тексті, команда, натискання' },
              { icon: '🖼', text: 'Медіа: фото, документ, голосове, стикер' },
              { icon: '📍', text: 'Telegram-дані: локація та контакт' },
              { icon: '⚙', text: 'Middleware: до кожного / після кожного повідомлення' },
            ]],
            ['card', '📎', [['text', 'Для вхідних файлів використовуй '], ['code', 'запомни файл → переменная'], ['text', ', а потім надсилай або пересилай збережений file_id.']]],
          ],
        },
      },
      {
        after: 'events',
        section: {
          id: 'media',
          emoji: '🖼',
          color: '#34d399',
          glow: 'rgba(52,211,153,0.2)',
          label: 'Медіа',
          title: '6. Надсилай медіа та інтерфейс',
          subtitle: 'Фото, відео, документи, контакти, локації, опитування й клавіатури.',
          body: [
            ['list', '#34d399', 'Доступно:', [
              { icon: '🖼', text: 'Фото, відео, аудіо, документ, стикер, відправити файл' },
              { icon: '👤', text: 'Контакт, локація та Telegram-опитування' },
              { icon: '⊞', text: 'Reply-кнопки, inline-кнопки та inline із БД' },
              { icon: '≡', text: 'Меню для простих навігаційних розділів' },
            ]],
            ['codeblock', [
              { c: '#e2e8f0', t: 'фото "https://site/image.jpg"' },
              { c: '#e2e8f0', t: 'опрос "Оберіть тариф"' },
              { c: '#3ecf8e', t: '    - "Basic"' },
              { c: '#3ecf8e', t: '    - "Pro"' },
            ]],
          ],
        },
      },
      {
        after: 'media',
        section: {
          id: 'data',
          emoji: '🗄',
          color: '#10b981',
          glow: 'rgba(16,185,129,0.2)',
          label: 'Дані',
          title: '7. Зберігай дані й підключай сервіси',
          subtitle: 'KV-сховище, глобальні значення, SQL, HTTP і AI-класифікація.',
          body: [
            ['list', '#10b981', 'Нові робочі можливості:', [
              { icon: '💾', text: 'Зберегти / отримати / видалити ключ поточного користувача' },
              { icon: '🌐', text: 'Глобальна БД і читання даних іншого користувача за ID' },
              { icon: '↗', text: 'HTTP GET/POST/PUT/PATCH/DELETE зі збереженням відповіді' },
              { icon: '🧠', text: 'Класифікація тексту, події аналітики та платежі' },
            ]],
            ['codeblock', [
              { c: '#e2e8f0', t: 'запрос GET "https://api.example.com" → ответ' },
              { c: '#e2e8f0', t: 'запрос_бд "select * from users" → rows' },
              { c: '#e2e8f0', t: 'классифицировать ["заказ", "вопрос"] → намерение' },
            ]],
          ],
        },
      },
      {
        after: 'data',
        section: {
          id: 'telegram',
          emoji: '✅',
          color: '#60a5fa',
          glow: 'rgba(96,165,250,0.2)',
          label: 'Telegram',
          title: '8. Використовуй Telegram-можливості',
          subtitle: 'Підписки, ролі, пересилання, сповіщення та розсилки.',
          body: [
            ['list', '#60a5fa', 'Корисні блоки:', [
              { icon: '✅', text: 'Перевірка підписки на канал перед доступом до бота' },
              { icon: '👮', text: 'Отримання ролі учасника групи або каналу' },
              { icon: '↗', text: 'Переслати вхідне фото, текст, документ, голосове або стикер' },
              { icon: '📡', text: 'Розсилка всім користувачам або групі за тегом' },
            ]],
            ['card', '🔐', [['text', 'Для адмінок комбінуй перевірку підписки, ролі, сховище й умови.']]],
          ],
        },
      },
    ],
  },
};

function cloneSection(section) {
  return { ...section, body: [...(section.body || [])] };
}

function applyGuideUpdates(base, lang) {
  const update = GUIDE_UPDATES[lang] || GUIDE_UPDATES.ru;
  const sections = base.sections.map((section) => {
    const replacement = update.replacements[section.id];
    return replacement ? { ...section, ...replacement } : cloneSection(section);
  });

  for (const { after, section } of update.inserts) {
    if (sections.some((item) => item.id === section.id)) continue;
    const idx = sections.findIndex((item) => item.id === after);
    sections.splice(idx >= 0 ? idx + 1 : sections.length, 0, cloneSection(section));
  }

  return { ...base, sections };
}

export function getInstructionWizardStrings(lang) {
  const lc = String(lang || 'ru').toLowerCase();
  if (lc === 'en') return applyGuideUpdates(en(), 'en');
  if (lc === 'uk') return applyGuideUpdates(uk(), 'uk');
  return applyGuideUpdates(ru(), 'ru');
}
