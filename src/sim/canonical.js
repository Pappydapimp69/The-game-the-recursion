// Canonical serialization for hashing game state. JSON.stringify emits keys in
// insertion order, so two logically-identical states can stringify differently
// and hash differently — useless for a golden/regression fingerprint. This
// walks the value with SORTED object keys and, crucially, fails LOUDLY on
// NaN/Infinity (a single leaked NaN silently poisons everything downstream —
// see dog#E3 — so the fingerprint must refuse to hash one).
// Precedent: ideas replay-fingerprint (canonical serialization requirement);
// the-game-prologue#E1.

export function stableStringify(value) {
  return walk(value);
}

function walk(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error(`stableStringify: non-finite number (${v}) — a determinism leak reached serialization`);
    }
    return String(v);
  }
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(v);
  if (t === 'undefined') {
    throw new Error('stableStringify: undefined is not serializable — omit the key or use null');
  }
  if (Array.isArray(v)) {
    return '[' + v.map(walk).join(',') + ']';
  }
  if (t === 'object') {
    const keys = Object.keys(v).sort();
    const parts = [];
    for (const k of keys) {
      const child = v[k];
      if (child === undefined) continue; // match JSON.stringify's drop-undefined-props
      parts.push(JSON.stringify(k) + ':' + walk(child));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new Error(`stableStringify: unsupported type ${t}`);
}
