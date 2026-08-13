import { defineConfig } from 'vite';
import { cpSync, mkdirSync, readFile, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const scribeRoot = resolve('node_modules/scribe.js-ocr');
const scribeMount = '/trip_planner/vendor/scribe';

const mime: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
};

/** Serve Scribe's module workers from this origin in development and copy the
 * minimal browser runtime beside the production bundle. Workers cannot load
 * cross-origin even though ordinary ESM imports can. */
const localScribePlugin = () => ({
  name: 'local-scribe-runtime',
  configureServer(server: { middlewares: { use: (fn: (
    req: { url?: string },
    res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (data?: Buffer) => void },
    next: () => void,
  ) => void) => void } }): void {
    server.middlewares.use((req, res, next) => {
      const pathname = decodeURIComponent((req.url ?? '').split('?', 1)[0]);
      if (!pathname.startsWith(`${scribeMount}/`)) return next();
      const file = resolve(scribeRoot, pathname.slice(scribeMount.length + 1));
      if (!file.startsWith(scribeRoot + sep)) return next();
      try {
        if (!statSync(file).isFile()) return next();
      } catch {
        return next();
      }
      readFile(file, (error, data) => {
        if (error) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
        res.end(data);
      });
    });
  },
  writeBundle(options: { dir?: string }): void {
    if (!options.dir) return;
    const target = resolve(options.dir, 'vendor/scribe');
    mkdirSync(target, { recursive: true });
    for (const dir of ['js', 'tess', 'lib']) {
      cpSync(resolve(scribeRoot, dir), resolve(target, dir), { recursive: true });
    }
    mkdirSync(resolve(target, 'fonts'), { recursive: true });
    cpSync(resolve(scribeRoot, 'fonts/encoding.js'), resolve(target, 'fonts/encoding.js'));
    for (const file of ['LICENSE', 'package.json']) cpSync(resolve(scribeRoot, file), resolve(target, file));
  },
});

// The app is published as a GitHub Pages *project* site at
// https://<user>.github.io/trip_planner/, so all asset URLs must be
// prefixed with the repository name.
export default defineConfig({
  base: '/trip_planner/',
  plugins: [localScribePlugin()],
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
