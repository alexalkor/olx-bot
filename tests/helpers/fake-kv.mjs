export function fakeKV(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    map: m,
    puts: 0,
    async get(key, opts) {
      if (!m.has(key)) return null;
      const v = m.get(key);
      const type = typeof opts === "string" ? opts : opts && opts.type;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key, val) { this.puts++; m.set(key, String(val)); },
    async delete(key) { m.delete(key); },
  };
}
