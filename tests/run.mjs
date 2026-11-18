// tests/run.mjs
// Τρέχει τα browser tests: σερβίρει τη ρίζα του repo και δίνει σε κάθε
// script το URL της σελίδας και έναν φάκελο για screenshots.
//   node tests/run.mjs              όλα
//   node tests/run.mjs login files  μόνο αυτά
// Το playwright βρίσκεται μέσω NODE_PATH (δεν υπάρχει node_modules στο repo).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });

const all = fs.readdirSync(path.join(here, "browser")).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3)).sort();
const wanted = process.argv.slice(2);
const scripts = wanted.length ? wanted : all;

const server = await startServer({ root });
const failed = [];
for (const name of scripts) {
    console.log(`== ${name}`);
    const code = await new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(here, "browser", `${name}.js`), `${server.url}/index.html`, out], {
            stdio: "inherit",
            env: { VW: "390", ...process.env },
        });
        child.on("exit", (c) => resolve(c));
    });
    if (code !== 0) failed.push(name);
}
await server.close();

if (failed.length) {
    console.log(`FAILED: ${failed.join(", ")}`);
    process.exit(1);
}
console.log("ALL BROWSER TESTS PASSED");
