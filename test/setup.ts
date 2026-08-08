/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test'
import schemaSql from '../schema.sql?raw'

// D1Database.exec() splits input by newline and can't handle multi-line
// statements (e.g. CREATE TRIGGER ... BEGIN ... END), so split schema.sql
// into individual statements ourselves and run each via prepare().run(),
// treating a BEGIN...END block as one statement regardless of line breaks.
function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let depth = 0
  let current = ''
  for (const line of sql.split('\n')) {
    current += (current ? '\n' : '') + line
    if (/\bBEGIN\b/i.test(line)) depth++
    if (/^\s*END;\s*$/i.test(line)) depth--
    if (depth === 0 && /;\s*$/.test(line)) {
      statements.push(current.trim())
      current = ''
    }
  }
  if (current.trim()) statements.push(current.trim())
  return statements.filter(Boolean)
}

for (const statement of splitStatements(schemaSql)) {
  await env.MEMO_D1.prepare(statement).run()
}
