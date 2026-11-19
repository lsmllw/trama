import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Gera um único index.html com JS e CSS embutidos: abre direto no navegador,
// sem servidor, e pode ser publicado como página estática.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
