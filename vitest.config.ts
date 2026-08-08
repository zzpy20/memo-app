import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: { MEMO_AUTH_TOKEN: 'test-token' },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
})
