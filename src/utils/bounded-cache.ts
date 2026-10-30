/**
 * Size-capped caches for values keyed by strings that callers may build from
 * data, such as template HTML or component CSS.
 *
 * @module utils/bounded-cache
 * @internal
 */

/** Entries a string-keyed cache keeps before it drops the oldest */
export const STRING_CACHE_LIMIT = 500;

/**
 * Stores `value` under `key`, dropping the oldest entry once the map holds
 * `limit` entries. A Map iterates in insertion order, so the first key is the
 * oldest.
 *
 * @internal
 */
export function setBounded<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  limit: number = STRING_CACHE_LIMIT
): void {
  if (cache.size >= limit && !cache.has(key)) {
    cache.delete(cache.keys().next().value as K);
  }
  cache.set(key, value);
}
