import React from 'react';

const FIELDS = {
  version:   [{ key:'version',   label:'версия (например 1.0)',     tag:'input' }],
  bot:       [{ key:'token',     label:'Telegram Bot Token',       tag:'input' }],
  commands:  [{ key:'commands',  label:'команды (каждая с новой строки):\n"/cmd" - "Описание"', tag:'textarea', rows:5 }],
  global:    [{ key:'varname',   label:'имя переменной',           tag:'input' },
              { key:'value',     label:'значение',                  tag:'input' }],
  block:     [{ key:'name',      label:'имя блока',                tag:'input' }],
  use:       [{ key:'blockname', label:'имя блока для использования', tag:'input' }],
  middleware:[{ key:'type',      label:'тип: before или after',    tag:'input' },
              { key:'code',      label:'код middleware',            tag:'textarea', rows:3 },
              { key:'return',    label:'вернуть после выполнения (true/false)', tag:'input' }],
  message:   [{ key:'text',      label:'текст',                    tag:'textarea', rows:3 }],
  buttons:   [{ key:'rows',      label:'кнопки (запятая = в ряд, новая строка = новый ряд)', tag:'textarea', rows:4 }],
  command:   [{ key:'cmd',       label:'команда (без /)',           tag:'input' }],
  condition: [{ key:'cond',      label:'условие',                  tag:'input' }],
  else:      [],
  ask:       [{ key:'question',  label:'вопрос',                   tag:'textarea', rows:2 },
              { key:'varname',   label:'переменная →',             tag:'input' }],
  remember:  [{ key:'varname',   label:'переменная',               tag:'input' },
              { key:'value',     label:'значение',                  tag:'input' }],
  get:       [{ key:'key',       label:'ключ в хранилище',          tag:'input' },
              { key:'varname',   label:'переменная →',             tag:'input' }],
  save:      [{ key:'key',       label:'ключ в хранилище',          tag:'input' },
              { key:'value',     label:'значение для сохранения',    tag:'input' }],
  scenario:  [{ key:'name',      label:'название',                 tag:'input' },
              { key:'text',      label:'текст первого шага',       tag:'textarea', rows:2 }],
  callback:  [{ key:'label',     label:'текст кнопки',             tag:'input' },
              { key:'return',    label:'вернуть после выполнения (true/false)', tag:'input' }],
  random:    [{ key:'variants',  label:'варианты (каждый с новой строки)', tag:'textarea', rows:4 }],
  switch:    [{ key:'varname',   label:'переменная',               tag:'input' },
              { key:'cases',     label:'значения (каждое с новой строки)', tag:'textarea', rows:3 }],
  photo:     [{ key:'url',       label:'URL фото или file_id',     tag:'input' },
              { key:'caption',   label:'подпись (опц.)',           tag:'textarea', rows:2 }],
  video:     [{ key:'url',       label:'URL видео или file_id',    tag:'input' },
              { key:'caption',   label:'подпись (опц.)',           tag:'textarea', rows:2 }],
  audio:     [{ key:'url',       label:'URL аудио или file_id',    tag:'input' }],
  document:  [{ key:'url',       label:'URL файла или file_id',    tag:'input' },
              { key:'filename',  label:'имя файла',                tag:'input' }],
  sticker:   [{ key:'file_id',   label:'file_id стикера',          tag:'input' }],
  delay:     [{ key:'seconds',   label:'секунд ожидания',          tag:'input' }],
  typing:    [{ key:'seconds',   label:'секунд "печатает..."',     tag:'input' }],
  http:      [{ key:'method',    label:'метод (GET / POST)',        tag:'input' },
              { key:'url',       label:'URL',                       tag:'input' },
              { key:'body',      label:'тело запроса (JSON, опц.)', tag:'textarea', rows:2 },
              { key:'varname',   label:'переменная для ответа',    tag:'input' }],
  goto:      [{ key:'target',    label:'название сценария',        tag:'input' }],
  stop:      [],
  step:      [{ key:'name',      label:'название шага',            tag:'input' },
              { key:'text',      label:'текст',                    tag:'textarea', rows:2 }],
  inline:    [{ key:'buttons',   label:'кнопки: Текст|callback, ...\n(запятая = в ряд, новая строка = новый ряд)', tag:'textarea', rows:4 }],
  loop:      [{ key:'mode',      label:'режим: count или while',   tag:'input' },
              { key:'count',     label:'сколько раз (если count)', tag:'input' },
              { key:'cond',      label:'условие (если while)',      tag:'input' }],
  menu:      [{ key:'title',     label:'заголовок меню',           tag:'input' },
              { key:'items',     label:'пункты (каждый с новой строки)', tag:'textarea', rows:4 }],
  notify:    [{ key:'text',      label:'текст уведомления',        tag:'textarea', rows:2 },
              { key:'target',    label:'кому (user_id / all)',      tag:'input' }],
  database:  [{ key:'query',     label:'SQL запрос',               tag:'textarea', rows:3 },
              { key:'varname',   label:'переменная для результата', tag:'input' }],
  classify:  [{ key:'intents',   label:'намерения (каждое с новой строки)', tag:'textarea', rows:3 },
              { key:'varname',   label:'переменная →',             tag:'input' }],
  log:       [{ key:'message',   label:'сообщение лога',           tag:'input' },
              { key:'level',     label:'уровень: info / warn / error', tag:'input' }],
  role:      [{ key:'roles',     label:'роли (каждая с новой строки)', tag:'textarea', rows:3 },
              { key:'varname',   label:'переменная с ролью',        tag:'input' }],
  payment:   [{ key:'provider',  label:'провайдер: stripe / telegram / crypto', tag:'input' },
              { key:'amount',    label:'сумма',                    tag:'input' },
              { key:'currency',  label:'валюта (USD, EUR, ...)',    tag:'input' },
              { key:'title',     label:'название платежа',          tag:'input' }],
  analytics: [{ key:'event',     label:'название события',         tag:'input' },
              { key:'params',    label:'параметры (опц.)',          tag:'textarea', rows:2 }],
};

const TYPE_HINTS = {
  version:   'Указывает версию бота. Должен быть в начале файла.',
  bot:       'Указывает токен Telegram бота. Должен быть в начале файла.',
  commands:  'Определяет команды меню, которые отображаются в Telegram при вводе /',
  global:    'Глобальная переменная, доступная всем пользователям бота.',
  block:     'Переиспользуемый блок кода. Можно вызывать через «использовать».',
  use:       'Вызывает переиспользуемый блок по имени.',
  middleware:'Выполняется до или после каждого сообщения (before/after).',
  get:       'Получает значение из хранилища по ключу и сохраняет в переменную.',
  save:      'Сохраняет значение в хранилище по ключу.',
  stop:      'Завершает диалог с пользователем. Последующие блоки не выполняются.',
  typing:    'Показывает индикатор «печатает» перед следующим сообщением.',
  delay:     'Делает паузу перед следующим блоком.',
  goto:      'Переходит к другому сценарию по его названию.',
  random:    'Случайно выбирает один из вариантов ответа.',
  http:      'Выполняет HTTP-запрос и сохраняет ответ в переменную.',
  inline:    'Создаёт inline-клавиатуру. Формат: Текст|callback_data',
  switch:    'Ветвление по значению переменной. Каждое значение — отдельная ветка.',
  loop:      'Повторяет дочерние блоки N раз или пока выполняется условие (count / while).',
  menu:      'Навигационное меню — список пунктов для перехода по сценариям.',
  notify:    'Отправляет push-уведомление пользователю или группе.',
  database:  'Выполняет SQL-запрос к БД и сохраняет результат в переменную.',
  classify:  'Определяет намерение пользователя из списка и сохраняет в переменную.',
  log:       'Записывает сообщение в лог (info / warn / error). Полезно для дебага.',
  role:      'Ветвление по роли пользователя: admin, user, guest и т.д.',
  payment:   'Инициирует платёж через Stripe, Telegram Pay или криптовалюту.',
  analytics: 'Отправляет событие в систему аналитики (конверсии, воронки и т.д.).',
};

export default function PropsPanel({ node, onChange, onDelete }) {
  if (!node) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:12, flexDirection:'column', gap:6 }}>
      <div style={{ fontSize:20, opacity:.3 }}>◈</div>
      <div>выбери блок</div>
    </div>
  );

  const { id, data } = node;
  const fields = FIELDS[data.type] || [];
  const props = data.props || {};
  const hint = TYPE_HINTS[data.type];

  return (
    <div style={{ flex:1, overflowY:'auto', borderBottom:'1px solid var(--border)' }}>
      <div style={{ padding:'8px 12px 6px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--border)' }}>
        <span style={{ fontSize:11, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.1em' }}>свойства</span>
        <button onClick={() => onDelete(id)} style={{ background:'transparent', color:'var(--text3)', fontSize:11, padding:'2px 6px', border:'1px solid var(--border2)', borderRadius:4, cursor:'pointer' }}
          onMouseEnter={e=>{e.target.style.color='var(--red)';e.target.style.borderColor='var(--red)'}}
          onMouseLeave={e=>{e.target.style.color='var(--text3)';e.target.style.borderColor='var(--border2)'}}>
          удалить
        </button>
      </div>

      <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:10 }}>
        <div>
          <div style={{ fontSize:9, color:'var(--text3)', marginBottom:3 }}>тип блока</div>
          <div style={{ fontSize:11, color:'var(--text2)', fontFamily:'var(--mono)' }}>{data.type}</div>
        </div>

        {hint && (
          <div style={{ fontSize:10, color:'var(--text3)', background:'var(--bg)', borderRadius:5, padding:'5px 8px', lineHeight:1.5 }}>
            ℹ {hint}
          </div>
        )}

        {fields.length === 0 && !hint && (
          <div style={{ fontSize:10, color:'var(--text3)' }}>Нет настроек для этого блока</div>
        )}

        {fields.map(f => (
          <div key={f.key}>
            <div style={{ fontSize:9, color:'var(--text3)', marginBottom:3, whiteSpace:'pre-line' }}>{f.label}</div>
            {f.tag === 'textarea'
              ? <textarea rows={f.rows||2} value={props[f.key]||''} style={{ resize:'vertical' }}
                  onChange={e => onChange(id, { ...props, [f.key]: e.target.value })} />
              : <input type="text" value={props[f.key]||''}
                  onChange={e => onChange(id, { ...props, [f.key]: e.target.value })} />
            }
          </div>
        ))}
      </div>
    </div>
  );
}
