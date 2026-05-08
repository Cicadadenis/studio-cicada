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

export function getInstructionWizardStrings(lang) {
  const lc = String(lang || 'ru').toLowerCase();
  if (lc === 'en') return en();
  if (lc === 'uk') return uk();
  return ru();
}
