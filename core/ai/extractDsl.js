/**
 * Извлечение тела Cicada DSL из «сырого» ответа ИИ (markdown, пояснения, несколько блоков кода).
 * Не валидирует синтаксис: только отделение артефакта от обвязки.
 */

/** @typedef {{ usedFence: 'cicada' | 'dsl' | 'generic' | 'none', candidates: number }} DslExtractionMeta */

const FENCE_CICADA = /```(?:cicada)\s*\n([\s\S]*?)```/gi;
const FENCE_DSL = /```(?:dsl)\s*\n([\s\S]*?)```/gi;
const FENCE_GENERIC = /```(?:[a-z0-9_-]*)\s*\n([\s\S]*?)```/gi;

function nonEmpty(s) {
  return String(s || '').trim().length > 0;
}

function longestBody(bodies) {
  let best = '';
  for (const b of bodies) {
    const t = String(b || '').trim();
    if (t.length > best.length) best = t;
  }
  return best;
}

/**
 * @param {string} rawAiText
 * @param {{ prefer?: 'first' | 'longest' }} [options]
 * @returns {{ dsl: string, meta: DslExtractionMeta }}
 */
export function extractDslFromAiText(rawAiText, options = {}) {
  const prefer = options.prefer || 'longest';
  const src = String(rawAiText ?? '');

  /** @type {Array<{ kind: 'cicada' | 'dsl' | 'generic', body: string }>} */
  const found = [];

  for (const re of [FENCE_CICADA, FENCE_DSL]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m[1] != null) found.push({ kind: re === FENCE_CICADA ? 'cicada' : 'dsl', body: m[1] });
    }
  }

  if (found.length === 0) {
    FENCE_GENERIC.lastIndex = 0;
    let m;
    while ((m = FENCE_GENERIC.exec(src)) !== null) {
      if (m[1] != null) found.push({ kind: 'generic', body: m[1] });
    }
  }

  const cicada = found.filter((x) => x.kind === 'cicada').map((x) => x.body);
  const dsl = found.filter((x) => x.kind === 'dsl').map((x) => x.body);
  const generic = found.filter((x) => x.kind === 'generic').map((x) => x.body);

  /** @type {string} */
  let dslText = '';
  /** @type {DslExtractionMeta} */
  const meta = { usedFence: 'none', candidates: found.length };

  const pickFrom = (arr, kind) => {
    if (!arr.length) return;
    dslText = prefer === 'first' ? String(arr[0] || '').trim() : longestBody(arr);
    meta.usedFence = kind;
  };

  if (cicada.length) pickFrom(cicada, 'cicada');
  else if (dsl.length) pickFrom(dsl, 'dsl');
  else if (generic.length) pickFrom(generic, 'generic');
  else dslText = src.trim();

  return { dsl: dslText, meta };
}
