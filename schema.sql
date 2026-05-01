-- Run this in Cloudflare D1 dashboard query console

CREATE TABLE IF NOT EXISTS memos (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  tags       TEXT NOT NULL DEFAULT '[]',  -- JSON array string
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- FTS5 virtual table for full-text search across title, body, tags
CREATE VIRTUAL TABLE IF NOT EXISTS memos_fts USING fts5(
  id    UNINDEXED,
  title,
  body,
  tags,
  content='memos',
  content_rowid='rowid'
);

-- Keep FTS index in sync automatically
CREATE TRIGGER IF NOT EXISTS memos_ai AFTER INSERT ON memos BEGIN
  INSERT INTO memos_fts(rowid, id, title, body, tags)
  VALUES (new.rowid, new.id, new.title, new.body, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memos_ad AFTER DELETE ON memos BEGIN
  INSERT INTO memos_fts(memos_fts, rowid, id, title, body, tags)
  VALUES ('delete', old.rowid, old.id, old.title, old.body, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS memos_au AFTER UPDATE ON memos BEGIN
  INSERT INTO memos_fts(memos_fts, rowid, id, title, body, tags)
  VALUES ('delete', old.rowid, old.id, old.title, old.body, old.tags);
  INSERT INTO memos_fts(rowid, id, title, body, tags)
  VALUES (new.rowid, new.id, new.title, new.body, new.tags);
END;
