/**
 * Лёгкий registry полей IR v2 (без Zod): required — ключи в props или общие правила узла.
 * refFields — поля, которые после build должны указывать на существующий compiler id.
 *
 * id узла IR = compiler id (не подпись кнопки).
 */

export const IR_NODE_REGISTRY = Object.freeze({
  callback: Object.freeze({
    requiredProps: ['label'],
    /** Обязателен либо props.gotoRef (compiler id цели), либо в графе от callback достижим узел goto с валидной целью (проверяется отдельно). */
    refProps: Object.freeze({
      gotoRef: Object.freeze({
        allowedTargetTypes: ['scenario', 'step', 'block'],
      }),
    }),
  }),
  scenario: Object.freeze({
    requiredProps: ['name'],
    refProps: Object.freeze({}),
  }),
  step: Object.freeze({
    /** Имя шага для DSL опционально до тех пор, пока на шаг нет «перейти по имени»; задача Studio — стабильный irId. */
    requiredProps: [],
    refProps: Object.freeze({}),
  }),
  /** Именованный блок DSL «блок имя:» */
  block: Object.freeze({
    requiredProps: ['name'],
    refProps: Object.freeze({}),
  }),
  goto: Object.freeze({
    requiredProps: [],
    refProps: Object.freeze({
      targetRef: Object.freeze({
        allowedTargetTypes: ['scenario', 'step', 'block'],
      }),
    }),
  }),
  use: Object.freeze({
    /** В soft-режиме; в strict см. validateIrV2 — нужен blockRef (compiler id блока). */
    requiredProps: ['blockname'],
    refProps: Object.freeze({
      blockRef: Object.freeze({
        allowedTargetTypes: ['block'],
      }),
    }),
  }),
});

/** Типы узлов, для которых включена строгая проверка registry (остальные — общие правила v2). */
export const IR_STRICT_NODE_TYPES = new Set(Object.keys(IR_NODE_REGISTRY));
