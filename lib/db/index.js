// Picks the storage backend: Postgres (Supabase) when DATABASE_URL is set, otherwise a local SQLite file.
// Every method is async so callers don't care which one they got.
const config = require('../config');
module.exports = config.databaseUrl ? require('./postgres')(config.databaseUrl) : require('./sqlite')();
