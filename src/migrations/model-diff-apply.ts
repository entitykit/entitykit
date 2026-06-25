/**
 * Translate diff operations in both directions so `up()` and `down()` stay
 * aligned. Implementations are split by direction to keep each exhaustive
 * operation switch focused.
 */
export { applyUp } from './model-diff-apply-up';
export { applyDown } from './model-diff-apply-down';
