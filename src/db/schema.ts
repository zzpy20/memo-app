import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const memos = sqliteTable('memos', {
  id:          text('id').primaryKey(),
  memo_id:     text('memo_id').notNull().unique(),
  uid:         text('uid').notNull().default(''),
  title:       text('title').notNull().default(''),
  description: text('description').notNull().default(''),
  cover_file:  text('cover_file').notNull().default(''),
  tags:        text('tags').notNull().default('[]'),
  pinned:      integer('pinned').notNull().default(0),
  links:       text('links').notNull().default('[]'),
  search_text: text('search_text').notNull().default(''),
  deleted_at:  text('deleted_at'),
  created_at:  text('created_at').notNull(),
  updated_at:  text('updated_at').notNull(),
})

export type Memo = typeof memos.$inferSelect
export type NewMemo = typeof memos.$inferInsert
