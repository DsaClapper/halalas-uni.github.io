// tests/preload.test.mjs — node --test tests/preload.test.mjs
// Τα modules ζητούνται όλα μαζί από την αρχή (<link rel="modulepreload">), όχι
// το ένα μετά το άλλο καθώς ο browser ανακαλύπτει τα imports. Η λίστα πρέπει να
// ακολουθεί τα αρχεία: ένα module που λείπει απλώς φορτώνει αργότερα.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every module is preloaded, and nothing else", () => {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const preloaded = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]).sort();
    const modules = fs.readdirSync(path.join(root, "js"))
        .filter((f) => f.endsWith(".js") && f !== "app-config.js")
        .map((f) => `js/${f}`)
        .sort();
    assert.deepEqual(preloaded, modules);
});
