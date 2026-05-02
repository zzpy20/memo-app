DROP TRIGGER IF EXISTS memos_ai;
DROP TRIGGER IF EXISTS memos_ad;
DROP TRIGGER IF EXISTS memos_au;
DROP TABLE IF EXISTS memos_fts;
DROP TABLE IF EXISTS memos;

CREATE TABLE memos (
  id          TEXT PRIMARY KEY,
  memo_id     TEXT UNIQUE NOT NULL,
  uid         TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cover_file  TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',
  pinned      INTEGER NOT NULL DEFAULT 0,
  links       TEXT NOT NULL DEFAULT '[]',
  search_text TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE VIRTUAL TABLE memos_fts USING fts5(
  id UNINDEXED, memo_id, uid, title, description, tags, search_text,
  content='memos', content_rowid='rowid'
);

CREATE TRIGGER memos_ai AFTER INSERT ON memos BEGIN
  INSERT INTO memos_fts(rowid,id,memo_id,uid,title,description,tags,search_text)
  VALUES(new.rowid,new.id,new.memo_id,new.uid,new.title,new.description,new.tags,new.search_text);
END;

CREATE TRIGGER memos_ad AFTER DELETE ON memos BEGIN
  INSERT INTO memos_fts(memos_fts,rowid,id,memo_id,uid,title,description,tags,search_text)
  VALUES('delete',old.rowid,old.id,old.memo_id,old.uid,old.title,old.description,old.tags,old.search_text);
END;

CREATE TRIGGER memos_au AFTER UPDATE ON memos BEGIN
  INSERT INTO memos_fts(memos_fts,rowid,id,memo_id,uid,title,description,tags,search_text)
  VALUES('delete',old.rowid,old.id,old.memo_id,old.uid,old.title,old.description,old.tags,old.search_text);
  INSERT INTO memos_fts(rowid,id,memo_id,uid,title,description,tags,search_text)
  VALUES(new.rowid,new.id,new.memo_id,new.uid,new.title,new.description,new.tags,new.search_text);
END;
