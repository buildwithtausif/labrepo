import { dev } from 'astro';

async function main() {
  try {
    const devServer = await dev({
      root: './',
    });
    console.log('[astro] Dev server listening on http://localhost:4321');
  } catch (err) {
    console.error('[astro] Failed to start dev server:', err);
    process.exit(1);
  }
}

main();
