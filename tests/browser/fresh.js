// Ανοίγεις την εφαρμογή μετά από ένα deploy και βλέπεις τη νέα έκδοση, όχι
// την παλιά από την cache (το Pages κρατάει τη σελίδα 10'). Ο server εδώ είναι
// δικός του: σερβίρει σφραγισμένα builds v0/v1/v2 και αλλάζει από το ένα στο
// άλλο όπως ένα deploy. Χωρίς page.route: η παρεμβολή αιτημάτων κλείνει την
// cache του browser, που είναι ακριβώς αυτό που ελέγχεται εδώ. Το API απλώς
// δεν απαντά (ο host δείχνει σε κλειστή θύρα), όπως όταν πέφτει ο server.
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const REPO = path.join(__dirname, "..", "..");
const T = { timeout: 8000 };

// Ένας SW όπως αυτός που έχουν όσοι άνοιξαν ειδοποιήσεις πριν από αυτή την
// αλλαγή: χωρίς fetch handler.
const OLD_SW = 'self.addEventListener("push", () => {});\n';

async function build(version, { oldWorker = false } = {}) {
    const { stamp } = await import("../../tools/stamp.mjs");
    const out = fs.mkdtempSync(path.join(os.tmpdir(), `fresh-${version}-`));
    await stamp(REPO, out, version);
    const index = path.join(out, "index.html");
    let html = fs.readFileSync(index, "utf8").replace("<title>", `<!-- build ${version} --><title>`);
    if (oldWorker) {
        fs.writeFileSync(path.join(out, "sw.js"), OLD_SW);
        html = html.replace("</body>", `<script>navigator.serviceWorker.register("/sw.js?v=${version}");</script></body>`);
    }
    fs.writeFileSync(index, html);
    // Ένα deploy έρχεται λεπτά μετά το προηγούμενο· builds του ίδιου
    // δευτερολέπτου θα είχαν ίδιο Last-Modified και θα έπαιρναν 304.
    const when = new Date(Date.UTC(2026, 0, 1, Number(version.slice(1))));
    fs.utimesSync(index, when, when);
    return out;
}

// `noWorker`: χωρίς service worker, όπως όταν αυτός δεν βοηθάει (το iPhone με
// την εφαρμογή στην αρχική οθόνη άνοιξε παλιά σελίδα από τη μνήμη του).
async function open(browser, { noWorker = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: noWorker ? "block" : "allow" });
    const page = await ctx.newPage();
    const errors = [];
    const assets = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
        const u = new URL(r.url());
        if (u.hostname === "127.0.0.1" && /\.(css|js)$/.test(u.pathname)) assets.push(u.pathname + u.search);
    });
    return { ctx, page, errors, assets };
}

// true όταν ένας SW ελέγχει τη σελίδα (μέσα σε 5").
const controlled = (page) => page.evaluate(() => new Promise((resolve) => {
    if (!("serviceWorker" in navigator)) return resolve(false);
    if (navigator.serviceWorker.controller) return resolve(true);
    navigator.serviceWorker.addEventListener("controllerchange", () => resolve(true), { once: true });
    setTimeout(() => resolve(Boolean(navigator.serviceWorker.controller)), 5000);
}));

const build_ = async (page) => (await page.content()).match(/<!-- build (\w+) -->/)?.[1];

(async () => {
    const { startServer } = await import("../serve.mjs");
    const builds = { v0: await build("v0", { oldWorker: true }), v1: await build("v1"), v2: await build("v2"), never: await build("v3") };
    // Ο server λέει ότι υπάρχει έκδοση που η σελίδα δεν θα γίνει ποτέ.
    fs.writeFileSync(path.join(builds.never, "version.json"), JSON.stringify({ version: "v9" }));
    const server = await startServer({ root: builds.v1 });
    const URL_ = `${server.url}/index.html`;
    const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP uni-api.halalas-services.xyz 127.0.0.1:9"] });
    const results = [];
    const check = async (name, fn, options) => {
        let app = null;
        try {
            app = await open(browser, options);
            await fn(app);
            assert.deepEqual(app.errors, [], "page errors");
            results.push(`PASS  ${name}`);
        } catch (e) {
            results.push(`FAIL  ${name}\n      ${e.message.split("\n").slice(0, 6).join("\n      ")}`);
        } finally {
            if (app) await app.ctx.close();
        }
    };
    // Νέα πλοήγηση στο ίδιο URL, όπως όταν ξανανοίγεις την εφαρμογή.
    const reopen = async (page) => {
        await page.goto("about:blank");
        await page.goto(URL_, T);
        await page.waitForTimeout(300);
    };

    await check("a new deploy shows on the next open", async ({ page, assets }) => {
        server.setRoot(builds.v1);
        await page.goto(URL_, T);
        assert.equal(await controlled(page), true, "a worker controls the page");
        assert.equal(await build_(page), "v1");
        server.setRoot(builds.v2);
        assets.length = 0;
        await reopen(page);
        assert.equal(await build_(page), "v2");
        assert.ok(assets.length >= 4, `css/js requests: ${assets.join(", ")}`);
        assert.deepEqual(assets.filter((a) => !a.endsWith("?v=v2")), []);
    });

    // Όσοι έχουν τον παλιό SW (χωρίς fetch handler) βλέπουν την πρώτη νέα
    // σελίδα όπως σήμερα, όταν λήξει η cache της. Από εκεί και πέρα ο νέος SW
    // έχει πάρει τη θέση του και κάθε επόμενο deploy φαίνεται αμέσως.
    await check("an old worker is replaced once the new page loads", async ({ page }) => {
        server.setRoot(builds.v0);
        await page.goto(URL_, T);
        await page.waitForTimeout(1000);
        await reopen(page); // ο παλιός SW δεν έκανε claim· ελέγχει από το επόμενο άνοιγμα
        assert.equal(await controlled(page), true, "the old worker controls the page");
        assert.equal(await build_(page), "v0");
        server.setRoot(builds.v1);
        await page.reload(T); // η cache των 10' έληξε
        assert.equal(await build_(page), "v1");
        await page.waitForTimeout(1500); // ο νέος SW εγκαθίσταται
        server.setRoot(builds.v2);
        await reopen(page);
        assert.equal(await build_(page), "v2");
    });

    const navigations = (page) => {
        const seen = [];
        page.on("framenavigated", (f) => f === page.mainFrame() && f.url().startsWith("http") && seen.push(f.url()));
        return seen;
    };
    const bannerShown = (page) => page.evaluate(() => !document.getElementById("updateBanner").hidden);

    // Η σελίδα ξέρει την έκδοσή της· αν ο server έχει νεότερη, ξαναφορτώνει
    // μόνη της μία φορά — ακόμα κι όταν ο service worker δεν βοήθησε.
    await check("a stale page from the cache updates itself", async ({ page }) => {
        server.setRoot(builds.v1);
        await page.goto(URL_, T);
        await page.waitForTimeout(800);
        server.setRoot(builds.v2);
        await reopen(page); // από την cache: v1
        await page.waitForFunction(() => document.documentElement.outerHTML.includes("<!-- build v2 -->"), null, T);
        assert.equal(await bannerShown(page), false);
    }, { noWorker: true });

    await check("returning to an open app updates it", async ({ page }) => {
        server.setRoot(builds.v1);
        await page.goto(URL_, T);
        await page.waitForTimeout(800);
        server.setRoot(builds.v2);
        await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await page.waitForFunction(() => document.documentElement.outerHTML.includes("<!-- build v2 -->"), null, T);
    }, { noWorker: true });

    await check("an open dialog is not thrown away: the banner shows instead", async ({ page }) => {
        server.setRoot(builds.v1);
        await page.goto(URL_, T);
        await page.waitForTimeout(800);
        const seen = navigations(page);
        await page.evaluate(async () => {
            const { openAppModal } = await import(document.querySelector('script[type="module"]').src.replace(/main\.js/, "modal.js"));
            openAppModal({ title: "α", message: "α" });
        });
        server.setRoot(builds.v2);
        await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await page.waitForTimeout(1500);
        assert.deepEqual(seen, [], "no reload");
        assert.equal(await bannerShown(page), true);
    }, { noWorker: true });

    await check("a version that never arrives reloads once, then shows the banner", async ({ page }) => {
        server.setRoot(builds.never);
        const seen = navigations(page);
        await page.goto(URL_, T);
        await page.waitForTimeout(3000);
        assert.equal(seen.length, 2, `navigations: ${seen.length}`);
        assert.equal(await bannerShown(page), true);
    }, { noWorker: true });

    // Το Pages στέλνει /φάκελος → /φάκελος/ με redirect. Ένας service worker
    // που ακολουθεί μόνος του το redirect δίνει στον browser απάντηση που αυτός
    // απορρίπτει για πλοήγηση: σελίδα σφάλματος αντί για τη σελίδα του server.
    await check("a redirected page still opens through the worker", async ({ page }) => {
        server.setRoot(builds.v1);
        await page.goto(URL_, T);
        assert.equal(await controlled(page), true, "a worker controls the page");
        const response = await page.goto(`${server.url}/imgs`, T);
        assert.equal(new URL(page.url()).pathname, "/imgs/");
        assert.equal(response.status(), 404);
    });

    // «Χωρίς δίκτυο» = ο server κλείνει. Το ctx.setOffline δεν κόβει τα
    // αιτήματα του service worker, οπότε δεν θα έλεγχε τίποτα.
    const offlineOpen = async (page, site) => {
        await site.close();
        await page.goto("about:blank");
        return page.goto(`${site.url}/index.html`, T).then(() => true, () => false);
    };

    // Μέσα στα 10' της cache, χωρίς δίκτυο ανοίγει ό,τι είδες τελευταία (όπως
    // και χωρίς SW).
    await check("offline still opens what was last seen", async ({ page }) => {
        const site = await startServer({ root: builds.v1 });
        await page.goto(`${site.url}/index.html`, T);
        await controlled(page);
        assert.equal(await offlineOpen(page, site), true, "the page opened");
        assert.equal(await build_(page), "v1");
    });

    // Μετά τα 10', χωρίς δίκτυο ο browser δείχνει τη δική του σελίδα, όπως
    // πάντα· όχι μια παλιά σελίδα της οποίας τα css/js μπορεί να έχουν λήξει.
    await check("offline after the page cache expired is the browser's own page", async ({ page }) => {
        const site = await startServer({ root: builds.v1, htmlMaxAge: 0 });
        await page.goto(`${site.url}/index.html`, T);
        await controlled(page);
        const opened = await offlineOpen(page, site);
        assert.equal(opened && (await build_(page)) === "v1", false, "an expired page came back offline");
    });

    await browser.close();
    await server.close();
    console.log(results.join("\n"));
    if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})();
