/** Small shared helpers for rate-limit-aware batch fetching across broker modules. */

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

/**
 * Run async `fn` over `items` in fixed-size chunks with a delay between chunks
 * (not within one).
 *
 * A single chunk's failure (transient network blip, one bad quote, etc.) does
 * NOT abort the whole batch — it's logged and substituted with an empty array
 * so callers that flatten/iterate `results` (e.g. `for (const [k, v] of batch)`)
 * keep working, and the caller still gets every OTHER chunk's real data instead
 * of the entire request failing over to a stale/last-good cache.
 *
 * A 429/rate-limit error on a chunk backs off for an extra `delayMs` before
 * moving on, since hammering the next chunk immediately would likely just
 * trigger the same rate limit again.
 */
export async function batchWithDelay(items, size, delayMs, fn) {
  const chunks = chunkArray(items, size);
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    let isRateLimited = false;
    try {
      results.push(await fn(chunks[i], i));
    } catch (err) {
      isRateLimited = /429|too many/i.test(err?.message || "");
      console.warn(
        `  ⚠️ batchWithDelay: chunk ${i + 1}/${chunks.length} failed (${chunks[i].length} items) — ${err?.message || err}`
      );
      results.push([]);
    }
    if (i < chunks.length - 1) await sleep(isRateLimited ? delayMs * 2 : delayMs);
  }
  return results;
}
