// tools/stamp.mjs
// Αντιγράφει το site για δημοσίευση και σφραγίζει κάθε τοπικό css/js με την
// έκδοση (το commit). Έτσι ένα νέο HTML δεν φορτώνει ποτέ παλιό css/js από
// την cache του browser, και κανείς δεν χρειάζεται να αλλάζει ?v= με το χέρι.
//   node tools/stamp.mjs <src> <out> <version>
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Δεν δημοσιεύονται.
const SKIP = new Set([".git", ".github", ".superpowers", "tests", "tools", "docs"]);

// href="css/a.css" / src="js/b.js", όχι απόλυτα URLs (https:, //cdn).
const ASSET_ATTR = /((?:href|src)=")((?!\/\/)(?![a-z][a-z0-9+.-]*:)[^"?#]+\.(?:css|js))(?:\?v=[^"]*)?"/gi;
// import … from "./x.js", import "./x.js", import("./x.js"), export … from "./x.js"
const RELATIVE_IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.\.?\/[^"']+?\.js)(?:\?v=[^"']*)?\2/g;
const SW_REGISTER = /register\((["'])\/sw\.js(?:\?v=[^"']*)?\1/g;

function stampHtml(text, version) {
    return stampJs(text.replace(ASSET_ATTR, (_, attr, url) => `${attr}${url}?v=${version}"`), version);
}

function stampJs(text, version) {
    return text
        .replace(RELATIVE_IMPORT, (_, lead, q, url) => `${lead}${q}${url}?v=${version}${q}`)
        .replace(SW_REGISTER, (_, q) => `register(${q}/sw.js?v=${version}${q}`);
}

async function copy(src, out, version, top = true) {
    await fs.mkdir(out, { recursive: true });
    for (const entry of await fs.readdir(src, { withFileTypes: true })) {
        if (top && SKIP.has(entry.name)) continue;
        const from = path.join(src, entry.name);
        const to = path.join(out, entry.name);
        if (entry.isDirectory()) {
            await copy(from, to, version, false);
        } else if (entry.name.endsWith(".html")) {
            await fs.writeFile(to, stampHtml(await fs.readFile(from, "utf8"), version));
        } else if (entry.name.endsWith(".js")) {
            await fs.writeFile(to, stampJs(await fs.readFile(from, "utf8"), version));
        } else {
            await fs.copyFile(from, to);
        }
    }
}

export async function stamp(src, out, version) {
    if (!/^[0-9A-Za-z._-]+$/.test(version)) throw new Error(`bad version: ${version}`);
    await copy(path.resolve(src), path.resolve(out), version);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [src, out, version] = process.argv.slice(2);
    if (!src || !out || !version) {
        console.error("usage: node tools/stamp.mjs <src> <out> <version>");
        process.exit(2);
    }
    await stamp(src, out, version);
}
