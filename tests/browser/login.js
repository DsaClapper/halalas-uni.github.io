// Login screen: a real form (Enter submits, password managers recognise it),
// pinch zoom allowed, and no input small enough for iOS to zoom on focus.
// Mocked API, iPhone-sized viewport.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

// node tests/run.mjs passes the page URL as argv[2].
const SITE = process.argv[2];

const SESSION = {
    ok: true,
    user: { firstName: "ΔΟΚΙΜΗ", lastName: "ΧΡΗΣΤΗΣ", fullName: "ΧΡΗΣΤΗΣ ΔΟΚΙΜΗ", ID: "1234" },
    courses: [{ name: "ΗΥ-240 Δομές", overallGrade: "7", grades: [{ name: "Κουίζ", grade: 7 }] }],
    eduportalGrades: [
        { courseCode: "ΗΥ-100", title: "Εισαγωγή", grade: 7, isPassed: true, ects: 6, semester: "Χειμερινό", category: "Κορμός" },
        { courseCode: "ΗΥ-150", title: "Προγραμματισμός", grade: 4, isPassed: false, ects: 6, semester: "Εαρινό", category: "Επιλογής" },
    ],
    assignments: [],
};

async function newPage(browser, { signedIn, loginDelay = 0, backfill = null }) {
    const ctx = await browser.newContext({
        viewport: { width: Number(process.env.VW || 390), height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    });
    await ctx.addInitScript(() => localStorage.setItem("halalasRememberSession", "true"));
    const page = await ctx.newPage();
    const errors = [];
    const logins = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(/uni-api\.halalas-services\.xyz/, async (route) => {
        const req = route.request();
        const url = req.url();
        if (/\/auth\/session$/.test(url)) {
            return signedIn
                ? route.fulfill({ json: SESSION })
                : route.fulfill({ status: 401, json: { ok: false, code: "NO_SESSION", message: "No session." } });
        }
        if (/\/auth\/refresh$/.test(url)) return route.fulfill({ json: SESSION });
        if (/\/auth\/login$/.test(url)) {
            logins.push({ method: req.method(), body: req.postDataJSON() });
            if (loginDelay) await new Promise((resolve) => setTimeout(resolve, loginDelay));
            return route.fulfill({ status: 401, json: { ok: false, code: "INVALID_CREDENTIALS", message: "Invalid credentials." } });
        }
        if (backfill && /\/history\/backfill$/.test(url)) return route.fulfill(backfill);
        return route.fulfill({ json: { ok: true, entries: [], history: [], enabled: true } });
    });
    await page.goto(SITE);
    if (signedIn) {
        await page.waitForFunction(() => document.getElementById("sdStudentID").textContent === "1234", null, { timeout: 15000 });
        await page.waitForTimeout(1500);
    } else {
        await page.locator("#loginWrapper").waitFor({ state: "visible", timeout: 15000 });
        await page.waitForTimeout(500);
    }
    return { ctx, page, errors, logins };
}

(async () => {
    const browser = await chromium.launch();
    const results = [];
    const check = async (name, fn) => {
        try {
            await fn();
            results.push(`PASS  ${name}`);
        } catch (e) {
            results.push(`FAIL  ${name}\n      ${e.message.split("\n").slice(0, 5).join("\n      ")}`);
        }
    };
    const T = { timeout: 3000 };

    await check("Enter in the password field submits", async () => {
        const { ctx, page, logins, errors } = await newPage(browser, { signedIn: false });
        try {
            await page.fill("#username", "csd0000", T);
            await page.fill("#password", "secret", T);
            await page.check("#remember", T);
            await page.press("#password", "Enter", T);
            await page.waitForTimeout(1200);
            assert.deepEqual(logins, [{ method: "POST", body: { username: "csd0000", password: "secret", remember: true } }]);
            assert.deepEqual(errors, []);
        } finally {
            await ctx.close();
        }
    });

    await check("button click submits once", async () => {
        const { ctx, page, logins } = await newPage(browser, { signedIn: false });
        try {
            await page.fill("#username", "csd0000", T);
            await page.fill("#password", "secret", T);
            await page.click(".login-btn", T);
            await page.waitForTimeout(1200);
            assert.deepEqual(logins, [{ method: "POST", body: { username: "csd0000", password: "secret", remember: false } }]);
        } finally {
            await ctx.close();
        }
    });

    await check("a double submit sends one login", async () => {
        const { ctx, page, logins } = await newPage(browser, { signedIn: false, loginDelay: 900 });
        try {
            await page.fill("#username", "csd0000", T);
            await page.fill("#password", "secret", T);
            await page.evaluate(() => {
                const form = document.getElementById("loginForm");
                form.requestSubmit();
                form.requestSubmit();
            });
            await page.waitForTimeout(2200);
            assert.equal(logins.length, 1);
            // The lock opens again once the answer is in.
            await page.locator("#loginWrapper").waitFor({ state: "visible", timeout: 5000 });
            await page.evaluate(() => document.getElementById("loginForm").requestSubmit());
            await page.waitForTimeout(1500);
            assert.equal(logins.length, 2);
        } finally {
            await ctx.close();
        }
    });

    await check("empty fields never reach the server", async () => {
        const { ctx, page, logins } = await newPage(browser, { signedIn: false });
        try {
            await page.fill("#username", "  ", T);
            await page.click(".login-btn", T);
            await page.waitForTimeout(800);
            assert.equal(logins.length, 0);
            assert.equal(await page.locator("#loginWrapper").isVisible(), true);
            assert.equal((await page.textContent("#loginStatus")).trim(), "Συμπλήρωσε όνομα χρήστη και κωδικό.");
        } finally {
            await ctx.close();
        }
    });

    await check("a rate-limited history import says to wait", async () => {
        const { ctx, page } = await newPage(browser, {
            signedIn: true, backfill: { status: 429, json: { ok: false, code: "RATE_LIMITED", message: "x" } },
        });
        try {
            await page.getByRole("tab", { name: "Ιστορικό" }).or(page.getByRole("button", { name: "Ιστορικό" })).first().click(T);
            await page.waitForTimeout(600);
            await page.click("#historyBackfillBtn", T);
            await page.fill("#appModalInput", "secret", T);
            await page.click("#appModalConfirm", T);
            await page.waitForTimeout(900);
            assert.equal((await page.textContent("#historyNote")).trim(), "Πολλές εισαγωγές σε λίγη ώρα. Δοκιμάστε ξανά σε μία ώρα.");
        } finally {
            await ctx.close();
        }
    });

    const { ctx, page } = await newPage(browser, { signedIn: false });
    if (process.argv[3]) await page.screenshot({ path: `${process.argv[3]}/login-screen.png` });
    const dom = await page.evaluate(() => {
        const attrs = (el, names) => (el ? Object.fromEntries(names.map((n) => [n, el.getAttribute(n)])) : null);
        const username = document.getElementById("username");
        const password = document.getElementById("password");
        return {
            username: attrs(username, ["type", "name", "autocomplete", "autocapitalize", "autocorrect", "spellcheck"]),
            usernameLabel: (document.querySelector('label[for="username"]') || {}).textContent || null,
            hasEmail: Boolean(document.getElementById("email")),
            password: attrs(password, ["type", "autocomplete"]),
            inForm: [username, password].map((el) => Boolean(el && el.closest("form#loginForm"))),
            viewport: document.querySelector("meta[name=viewport]").getAttribute("content"),
            theme: document.querySelector("meta[name=theme-color]").getAttribute("content"),
        };
    });
    await ctx.close();

    await check("username field is a plain username field", async () => {
        assert.deepEqual(dom.username, {
            type: "text", name: "username", autocomplete: "username", autocapitalize: "none", autocorrect: "off", spellcheck: "false",
        });
        assert.equal(dom.usernameLabel, "Όνομα χρήστη UOC");
        assert.equal(dom.hasEmail, false);
    });
    await check("password field helps password managers", async () => {
        assert.deepEqual(dom.password, { type: "password", autocomplete: "current-password" });
        assert.deepEqual(dom.inForm, [true, true]);
    });
    await check("zoom is allowed", async () => {
        assert.doesNotMatch(dom.viewport, /user-scalable|maximum-scale/);
        assert.match(dom.viewport, /width=device-width/);
    });
    await check("theme colour is the page background", async () => {
        assert.equal(dom.theme, "#000000");
    });

    await check("no input zooms the page on iOS", async () => {
        const { ctx, page, errors } = await newPage(browser, { signedIn: true });
        try {
            await page.getByRole("tab", { name: "Ιστορικό" }).or(page.getByRole("button", { name: "Ιστορικό" })).first().click(T);
            await page.waitForTimeout(600);
            await page.click("#historyBackfillBtn", T);
            await page.locator("#appModalInput").waitFor({ state: "visible", timeout: 3000 });
            // Hidden ones too: a filter that appears later must not be small either.
            const small = await page.evaluate(() =>
                [...document.querySelectorAll('input:not([type="checkbox"]), select')]
                    .map((el) => ({ id: el.id || el.className, size: parseFloat(getComputedStyle(el).fontSize) }))
                    .filter((el) => el.size < 16),
            );
            assert.deepEqual(small, []);
            assert.deepEqual(errors, []);
        } finally {
            await ctx.close();
        }
    });

    await browser.close();
    console.log(results.join("\n"));
    if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})();
