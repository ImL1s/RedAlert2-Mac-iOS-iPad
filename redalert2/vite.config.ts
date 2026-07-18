import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import fs from 'fs';
import path from 'path';
const devPort = 4000;
// Mirrors the iOS shell's ra2app://app/gameres/ mount so the ?shell code path
// (first-launch asset seeding) is testable in a desktop browser.
const gameResDir = path.resolve(__dirname, '../gameres-export');
const serveGameResDev = (): Plugin => ({
    name: 'serve-gameres-dev',
    configureServer(server) {
        server.middlewares.use('/gameres', (req, res, next) => {
            const relPath = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
            const filePath = path.join(gameResDir, relPath);
            if (!filePath.startsWith(gameResDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
                next();
                return;
            }
            res.setHeader('Content-Type', filePath.endsWith('.json') ? 'application/json' : 'application/octet-stream');
            res.setHeader('Content-Length', fs.statSync(filePath).size);
            fs.createReadStream(filePath).pipe(res);
        });
    },
});
const manualHttpsConfig = fs.existsSync('./certs/server.key') && fs.existsSync('./certs/server.crt')
    ? { key: fs.readFileSync('./certs/server.key'), cert: fs.readFileSync('./certs/server.crt') }
    : undefined;
// http://localhost is still a secure context, so SharedArrayBuffer keeps working
// with the COOP/COEP headers below. Used for embedded-browser dev and the iOS shell.
const useHttp = !!process.env.RA2_HTTP;
export default defineConfig({
    plugins: [react(), serveGameResDev(), ...(manualHttpsConfig || useHttp ? [] : [basicSsl()])],
    server: {
        host: '0.0.0.0',
        port: devPort,
        strictPort: true,
        https: useHttp ? undefined : (manualHttpsConfig ?? {}),
        headers: {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin',
        },
        fs: {
            allow: ['..']
        }
    },
    preview: {
        host: '0.0.0.0',
        port: devPort,
        strictPort: true,
    },
    resolve: {
        alias: {
            '@': '/src'
        }
    },
    optimizeDeps: {
        exclude: ['7z-wasm', '@ffmpeg/ffmpeg'],
        include: []
    },
    worker: {
        format: 'es'
    },
    assetsInclude: ['**/*.wasm']
});
