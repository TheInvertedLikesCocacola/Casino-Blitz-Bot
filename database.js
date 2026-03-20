const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./casino.db");

db.serialize(() => {

  db.run(`CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    chips INTEGER DEFAULT 1000
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS inventory (
    user_id TEXT,
    item TEXT,
    amount INTEGER,
    PRIMARY KEY (user_id, item)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pending_charms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    charm TEXT,
    status TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS active_charms (
    user_id TEXT,
    item TEXT,
    remaining_uses INTEGER,
    PRIMARY KEY (user_id, item)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS daily_games (
    user_id TEXT PRIMARY KEY,
    last_reset INTEGER,
    games_played INTEGER DEFAULT 0
  )`);

});

module.exports = db;
