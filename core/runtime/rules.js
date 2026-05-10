// Типы блоков-корней, которые обязаны что-то отправить пользователю.
export const HANDLER_ROOT_TYPES = new Set([
  'start',
  'command',
  'callback',
  'step',
  'on_photo',
  'on_voice',
  'on_document',
  'on_sticker',
  'on_location',
  'on_contact',
]);

// Типы блоков, которые реально что-то отправляют пользователю.
export const OUTPUT_BLOCK_TYPES = new Set([
  'message',
  'buttons',
  'inline',
  'photo',
  'sticker',
  'document',
  'send_file',
  'audio',
  'video',
  'poll',
  'contact',
  'location',
  'notify',
  'random',
  'ask',
]);

// Типы блоков, которые делегируют выполнение другому блоку/сценарию.
// run — IR-тип для DSL-инструкции «запустить сценарий».
export const DELEGATE_BLOCK_TYPES = new Set(['use', 'goto', 'run', 'stop']);

// Заголовки DSL-секций, которые являются контейнерами (не "пустые" блоки).
export const INLINE_BLOCK_HEADERS = new Set([
  'рандом',
  'кнопки',
  'inline-кнопки',
  'меню',
  'переключить',
  'повторять',
  'пока',
  'для',
  'таймаут',
  'если',
  'иначе',
  'шаг',
  'сценарий',
  'блок',
  'старт',
  'команда',
  'при',
  'до',
  'после',
]);

// Контекстные переменные, которые ядро задает автоматически.
export const RUNTIME_VARS = new Set([
  'текст',
  'кнопка',
  'файл_id',
  'тип_файла',
  'имя_файла',
  'широта',
  'долгота',
  'контакт_имя',
  'контакт_телефон',
  'стикер_emoji',
  'скачан',
]);

// Префиксы переменных, которые разрешены без предварительного определения.
export const RUNTIME_PREFIXES = ['пользователь.', 'чат.', 'пользователь', 'чат'];

// Зарезервированные имена runtime-полей.
export const RUNTIME_PROPERTY_NAMES = new Set([
  'id',
  'имя',
  'фамилия',
  'chat_id',
  'язык',
  'username',
  'first_name',
  'last_name',
  'language_code',
  'type',
]);

export function isRuntimeVar(name) {
  if (RUNTIME_VARS.has(name)) return true;
  if (RUNTIME_PROPERTY_NAMES.has(name)) return true;
  return RUNTIME_PREFIXES.some((prefix) => name.startsWith(prefix));
}
