// tests/stamp.test.mjs — node --test tests/stamp.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stamp } from "../tools/stamp.mjs";

const V = "abc1234";

async function build(files) {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "stamp-src-"));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "stamp-out-"));
    for (const [name, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(src, name)), { recursive: true });
        fs.writeFileSync(path.join(src, name), body);
    }
    await stamp(src, out, V);
    return (name) => fs.readFileSync(path.join(out, name), "utf8");
}

test("local css and js get the version", async () => {
    const read = await build({
        "index.html": `<link rel="stylesheet" href="css/a.css?v=20261115" />\n<script src="js/app-config.js" defer></script>\n<script type="module" src="js/main.js"></script>`,
    });
    const html = read("index.html");
    assert.match(html, /href="css\/a\.css\?v=abc1234"/);
    assert.match(html, /src="js\/app-config\.js\?v=abc1234" defer/);
    assert.match(html, /src="js\/main\.js\?v=abc1234"/);
    assert.doesNotMatch(html, /20261115/);
});

test("module imports get the version", async () => {
    const read = await build({
        "js/main.js": `import { state } from "./state.js";\nimport "../js/x.js";\nexport { y } from './y.js';\nconst f = await import("./files.js");\n`,
    });
    const js = read("js/main.js");
    assert.match(js, /from "\.\/state\.js\?v=abc1234"/);
    assert.match(js, /import "\.\.\/js\/x\.js\?v=abc1234"/);
    assert.match(js, /from '\.\/y\.js\?v=abc1234'/);
    assert.match(js, /import\("\.\/files\.js\?v=abc1234"\)/);
});

test("the service worker registration gets the version", async () => {
    const read = await build({
        "index.html": `<script>navigator.serviceWorker.register("/sw.js?v=20260926");</script>`,
        "js/push.js": `navigator.serviceWorker.register("/sw.js");`,
    });
    assert.match(read("index.html"), /register\("\/sw\.js\?v=abc1234"\)/);
    assert.match(read("js/push.js"), /register\("\/sw\.js\?v=abc1234"\)/);
});

test("foreign and non-code references stay as they are", async () => {
    const html = [
        `<script src="https://code.jquery.com/jquery-4.0.0.min.js"></script>`,
        `<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet" />`,
        `<script src="//cdn.example/x.js"></script>`,
        `<img src="imgs/logo.png" />`,
        `<link rel="manifest" href="manifest.webmanifest" />`,
        `<a href="#grades">x</a><svg><use href="#i-file"/></svg>`,
        `<script>fetch("https://uni-api.halalas-services.xyz/auth/session.js");</script>`,
    ].join("\n");
    const read = await build({ "index.html": html, "js/a.js": `import x from "https://cdn.example/lib.js";\n` });
    assert.equal(read("index.html"), html);
    assert.equal(read("js/a.js"), `import x from "https://cdn.example/lib.js";\n`);
});

test("tests, tools and docs are not published", async () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "stamp-src-"));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "stamp-out-"));
    for (const name of ["index.html", "CNAME", "tests/a.js", "tools/b.mjs", "docs/c.md", ".github/w.yml", ".git/HEAD", "imgs/l.png"]) {
        fs.mkdirSync(path.dirname(path.join(src, name)), { recursive: true });
        fs.writeFileSync(path.join(src, name), "x");
    }
    await stamp(src, out, V);
    const exists = (n) => fs.existsSync(path.join(out, n));
    assert.deepEqual(["tests", "tools", "docs", ".github", ".git"].filter(exists), []);
    assert.ok(exists("CNAME") && exists("index.html") && exists("imgs/l.png"));
});
