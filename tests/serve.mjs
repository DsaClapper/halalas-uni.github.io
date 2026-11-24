// tests/serve.mjs
// Στατικός server για τα browser tests. Τα ES modules δεν φορτώνουν από
// file://, και ο server μιμείται ό,τι κάνει το GitHub Pages με την cache:
// 10' για τη σελίδα, 4 ώρες για τα υπόλοιπα, Last-Modified και 304, και
// redirect για φάκελο χωρίς / στο τέλος.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
    ".json": "application/json",
};

// `htmlMaxAge`: για να δοκιμαστεί και η περίπτωση «η cache της σελίδας έληξε».
export async function startServer({ root, port = 0, htmlMaxAge = 600 }) {
    let base = path.resolve(root);
    const server = http.createServer(async (req, res) => {
        let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (rel.endsWith("/")) rel += "index.html";
        const file = path.join(base, rel);
        if (!file.startsWith(base + path.sep)) {
            res.writeHead(403);
            return res.end();
        }
        try {
            const stat = await fs.stat(file);
            // Όπως το Pages: φάκελος χωρίς / στο τέλος → redirect.
            if (stat.isDirectory()) {
                res.writeHead(301, { Location: `${rel}/` });
                return res.end();
            }
            const modified = new Date(Math.floor(stat.mtimeMs / 1000) * 1000);
            const headers = {
                "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
                "Cache-Control": file.endsWith(".html") ? `max-age=${htmlMaxAge}` : "max-age=14400",
                "Last-Modified": modified.toUTCString(),
            };
            const since = Date.parse(req.headers["if-modified-since"] || "");
            if (!Number.isNaN(since) && since >= modified.getTime()) {
                res.writeHead(304, headers);
                return res.end();
            }
            const body = await fs.readFile(file);
            res.writeHead(200, headers);
            res.end(req.method === "HEAD" ? undefined : body);
        } catch {
            res.writeHead(404);
            res.end();
        }
    });
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        setRoot(dir) {
            base = path.resolve(dir);
        },
        // Κλείνει και τις ανοιχτές συνδέσεις: έτσι το «χωρίς δίκτυο» είναι
        // πραγματικό και για τον service worker (το setOffline του Playwright
        // δεν φτάνει ως εκεί).
        close: () => new Promise((resolve) => {
            server.close(resolve);
            server.closeAllConnections();
        }),
    };
}
