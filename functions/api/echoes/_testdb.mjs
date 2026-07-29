// Minimal scriptable fake D1 database for unit-testing the /api/echoes/*
// Functions without a real database. Prefixed with an underscore (like
// _util.js) so it's excluded from Pages' file-based routing.
//
// handlers: array of { match: RegExp, all?, first?, run? } — each a
// (bindArgs) => value function. The first handler whose `match` tests true
// against the SQL string services the call. Every call (matched or not) is
// recorded in `.calls` so tests can assert exactly what was queried.
export function createFakeDb(handlers = []) {
  const calls = [];

  function respond(sql, args, method) {
    calls.push({ sql, args, method });
    const handler = handlers.find((h) => h.match.test(sql));
    if (!handler || typeof handler[method] !== "function") {
      return method === "all" ? { results: [] } : method === "first" ? null : { success: true };
    }
    return handler[method](args);
  }

  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            all: async () => respond(sql, args, "all"),
            first: async () => respond(sql, args, "first"),
            run: async () => respond(sql, args, "run"),
          };
        },
      };
    },
  };
}
