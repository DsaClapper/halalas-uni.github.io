// The notifications toggle shows what the server says (not a stale local
// flag), and turning it on does not ask to retype the password unless the
// server needs it. Push APIs and the backend are faked.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

// node tests/run.mjs passes the page URL as argv[2].
const SITE = process.argv[2];
const KEY = "halalasNotificationsEnabled";
const ENDPOINT = "https://push.example/abc";

const SESSION = {
    ok: true,
    user: { firstName: "ΔΟΚΙΜΗ", lastName: "ΧΡΗΣΤΗΣ", fullName: "ΧΡΗΣΤΗΣ ΔΟΚΙΜΗ", ID: "1234" },
    courses: [],
    eduportalGrades: [{ courseCode: "ΗΥ-100", title: "Εισαγωγή", grade: 7, isPassed: true, ects: 6, semester: "Χειμερινό", category: "Κορμός" }],
    assignments: [],
    notificationsAllowed: true,
};
const reply = (status, json) => ({ status, json });
const ON = () => reply(200, { ok: true, enabled: true, deviceSubscribed: true });
const OFF = () => reply(200, { ok: true, enabled: false, deviceSubscribed: false });
const badPassword = () => reply(401, { ok: false, code: "INVALID_CREDENTIALS", message: "Invalid credentials." });

// scenario: { permission, cached, subscribed, status(n), enable(n, body) }
async function open(browser, scenario) {
    const ctx = await browser.newContext({
        viewport: { width: Number(process.env.VW || 390), height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    });
    await ctx.addInitScript(({ permission, refuse, cached, subscribed, KEY, ENDPOINT }) => {
        localStorage.setItem("halalasRememberSession", "true");
        if (cached && !sessionStorage.getItem("seeded")) localStorage.setItem(KEY, "true");
        sessionStorage.setItem("seeded", "1");
        window.__permissionCalls = 0;
        const fakeNotification = {
            permission,
            requestPermission: async () => {
                window.__permissionCalls++;
                if (refuse) return (fakeNotification.permission = "denied");
                fakeNotification.permission = "granted";
                return "granted";
            },
        };
        Object.defineProperty(window, "Notification", { value: fakeNotification, configurable: true, writable: true });
        if (!("PushManager" in window)) window.PushManager = function PushManager() {};
        const subscription = {
            endpoint: ENDPOINT,
            toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a" } }),
            unsubscribe: async () => true,
        };
        let current = subscribed ? subscription : null;
        window.__unregisters = 0;
        const registration = {
            pushManager: { getSubscription: async () => current, subscribe: async () => (current = subscription) },
            unregister: async () => { window.__unregisters++; return true; },
        };
        Object.defineProperty(navigator, "serviceWorker", {
            configurable: true,
            value: { register: async () => registration, getRegistration: async () => registration, addEventListener() {} },
        });
    }, { permission: scenario.permission || "granted", refuse: Boolean(scenario.refuse), cached: Boolean(scenario.cached), subscribed: scenario.subscribed !== false, KEY, ENDPOINT });

    const page = await ctx.newPage();
    const errors = [];
    const calls = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const count = (name) => calls.filter((c) => c.name === name).length;
    await page.route(/uni-api\.halalas-services\.xyz/, async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (/^\/auth\/(session|refresh)$/.test(url.pathname)) return route.fulfill({ json: { ...SESSION, ...(scenario.session || {}) } });
        if (url.pathname === "/auth/logout") return route.fulfill({ json: { ok: true } });
        if (url.pathname.startsWith("/notifications/")) {
            const name = url.pathname.slice("/notifications/".length);
            let body = null;
            try { body = req.postDataJSON(); } catch { body = req.postData(); }
            calls.push({ name, method: req.method(), body });
            const handler = scenario[name];
            if (handler) {
                const answer = await handler(count(name), body);
                return answer === "abort" ? route.abort() : route.fulfill(answer);
            }
            if (name === "vapid-public-key") {
                return route.fulfill({ json: { ok: true, publicKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" } });
            }
            return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ json: { ok: true, entries: [], history: [], enabled: false } });
    });
    await page.goto(SITE);
    await page.waitForFunction(() => document.getElementById("sdStudentID").textContent === "1234", null, { timeout: 15000 });
    await page.waitForTimeout(1500);

    const status = () => page.evaluate(() => {
        const el = document.getElementById("dashboardStatus");
        return { text: el.textContent.trim(), error: el.classList.contains("is-error") };
    });
    const state = () => page.evaluate((KEY) => ({
        on: document.getElementById("notificationToggleInput").checked,
        key: localStorage.getItem(KEY),
        permissionCalls: window.__permissionCalls,
    }), KEY);
    const modal = () => page.evaluate(() => {
        const el = document.getElementById("appModal");
        return {
            open: !el.hidden && el.classList.contains("is-visible"),
            input: !document.getElementById("appModalInputGroup").hidden,
            confirm: document.getElementById("appModalConfirm").textContent.trim(),
            message: document.getElementById("appModalMessage").textContent.trim(),
        };
    });
    const clickToggle = async () => {
        await page.click("#notificationToggle", { timeout: 3000 });
        await page.waitForTimeout(400);
    };
    const confirm = async () => {
        await page.click("#appModalConfirm", { timeout: 3000 });
        await page.waitForTimeout(700);
    };
    const cancel = async () => {
        await page.click("#appModal .app-modal-secondary", { timeout: 3000 });
        await page.waitForTimeout(500);
    };
    const named = (name) => calls.filter((c) => c.name === name);
    return { ctx, page, errors, calls, named, state, status, modal, clickToggle, confirm, cancel };
}

(async () => {
    const browser = await chromium.launch();
    const results = [];
    const check = async (name, scenario, fn) => {
        let app = null;
        try {
            app = await open(browser, scenario);
            await fn(app);
            assert.deepEqual(app.errors, [], "page errors");
            results.push(`PASS  ${name}`);
        } catch (e) {
            results.push(`FAIL  ${name}\n      ${e.message.split("\n").slice(0, 6).join("\n      ")}`);
        } finally {
            if (app) await app.ctx.close();
        }
    };

    await check("server says on, cache says off", { status: ON }, async (app) => {
        assert.deepEqual(await app.state(), { on: true, key: "true", permissionCalls: 0 });
        assert.deepEqual(app.named("status"), [{ name: "status", method: "POST", body: { endpoint: ENDPOINT } }]);
    });

    await check("server says off, cache says on", { cached: true, status: OFF }, async (app) => {
        assert.deepEqual(await app.state(), { on: false, key: null, permissionCalls: 0 });
    });

    await check("enabled elsewhere but not on this device",
        { subscribed: false, status: () => reply(200, { ok: true, enabled: true, deviceSubscribed: false }) },
        async (app) => {
            assert.deepEqual(await app.state(), { on: false, key: null, permissionCalls: 0 });
            assert.deepEqual(app.named("status").map((c) => c.body), [{}]);
        });

    await check("status call fails (500)", { cached: true, status: () => reply(500, { ok: false, code: "SERVER_ERROR", message: "x" }) }, async (app) => {
        assert.equal(app.named("status").length, 1);
        assert.deepEqual(await app.state(), { on: true, key: "true", permissionCalls: 0 });
    });

    await check("status call fails (network)", { cached: true, status: () => "abort" }, async (app) => {
        assert.equal(app.named("status").length, 1);
        assert.deepEqual(await app.state(), { on: true, key: "true", permissionCalls: 0 });
    });

    await check("no permission, no prompt on load", { permission: "default", cached: true, status: ON }, async (app) => {
        assert.deepEqual(await app.state(), { on: false, key: null, permissionCalls: 0 });
    });

    await check("enabling needs no typing", { permission: "default", subscribed: false, status: OFF, enable: () => reply(200, { ok: true }) }, async (app) => {
        await app.clickToggle();
        const modal = await app.modal();
        assert.equal(modal.open, true);
        assert.equal(modal.input, false);
        assert.equal(modal.confirm, "Ενεργοποίηση");
        assert.match(modal.message, /κρυπτογραφημένος στον server/);
        assert.equal((await app.state()).permissionCalls, 0);
        assert.equal(app.named("enable").length, 0);
        await app.confirm();
        assert.deepEqual(app.named("enable"), [{ name: "enable", method: "POST", body: {} }]);
        assert.equal(app.named("subscribe").length, 1);
        assert.deepEqual(await app.state(), { on: true, key: "true", permissionCalls: 1 });
        assert.equal((await app.modal()).open, false);
    });

    await check("cancelling the confirmation", { status: OFF, enable: () => reply(200, { ok: true }) }, async (app) => {
        await app.clickToggle();
        await app.cancel();
        assert.equal(app.named("enable").length, 0);
        assert.deepEqual(await app.state(), { on: false, key: null, permissionCalls: 0 });
    });

    await check("no password is ever asked for", { status: OFF, enable: () => reply(403, { ok: false, code: "REMEMBER_REQUIRED", message: "x" }) }, async (app) => {
        await app.clickToggle();
        await app.confirm();
        assert.equal((await app.modal()).open, false, "no password prompt");
        assert.deepEqual(app.named("enable").map((c) => c.body), [{}]);
        assert.deepEqual(await app.status(), { text: "Συνδέσου ξανά με «Remember me» για να λαμβάνεις ειδοποιήσεις.", error: true });
    });

    await check("a password eLearn no longer takes says to sign in again", { status: OFF, enable: badPassword }, async (app) => {
        await app.clickToggle();
        await app.confirm();
        assert.equal((await app.modal()).open, false, "no password prompt");
        assert.deepEqual(await app.status(), { text: "Το eLearn δεν δέχτηκε τον κωδικό σου. Συνδέσου ξανά.", error: true });
    });

    await check("without Remember me the switch is greyed out", { session: { notificationsAllowed: false }, cached: true, status: ON }, async (app) => {
        assert.equal(await app.page.isDisabled("#notificationToggleInput"), true);
        assert.equal((await app.state()).on, false);
        assert.equal((await app.page.textContent("#notificationHint")).trim(), "Συνδέσου με «Remember me» για να λαμβάνεις ειδοποιήσεις.");
        await app.page.click("#notificationToggle", { timeout: 3000, force: true });
        await app.page.waitForTimeout(400);
        assert.equal((await app.modal()).open, false);
        assert.equal(app.named("enable").length, 0);
    });

    await check("switching off names this device", { cached: true, status: ON }, async (app) => {
        await app.clickToggle();
        await app.page.waitForTimeout(400);
        assert.deepEqual(app.named("disable").map((c) => c.body), [{ endpoint: ENDPOINT }]);
        assert.deepEqual(await app.state(), { on: false, key: null, permissionCalls: 0 });
    });

    await check("signing out stops this device", { cached: true, status: ON }, async (app) => {
        await app.page.click("#signOutBtn", { timeout: 3000 });
        await app.confirm();
        await app.page.waitForTimeout(500);
        const after = await app.page.evaluate((KEY) => ({ key: localStorage.getItem(KEY), unregisters: window.__unregisters }), KEY);
        assert.deepEqual(after, { key: null, unregisters: 1 });
    });

    // A switch that slides back with no word of why looks broken.
    const OFF_STATE = { on: false, key: null };
    const failing = [
        ["the browser blocks notifications", { permission: "denied" }, 0,
            "Οι ειδοποιήσεις είναι αποκλεισμένες για αυτή τη σελίδα. Επίτρεψέ τες από τις ρυθμίσεις του browser."],
        ["the permission prompt is refused", { permission: "default", refuse: true, subscribed: false }, 0,
            "Οι ειδοποιήσεις είναι αποκλεισμένες για αυτή τη σελίδα. Επίτρεψέ τες από τις ρυθμίσεις του browser."],
        ["too many attempts (429)", { enable: () => reply(429, { ok: false, code: "RATE_LIMITED", message: "x" }) }, 1,
            "Πολλές προσπάθειες. Δοκίμασε ξανά σε ένα λεπτό."],
        ["Moodle is down (502)", { enable: () => reply(502, { ok: false, code: "UPSTREAM_ERROR", message: "x" }) }, 1,
            "Το eLearn δεν απαντά αυτή τη στιγμή. Δοκίμασε ξανά αργότερα."],
        ["the network drops", { enable: () => "abort" }, 1,
            "Οι ειδοποιήσεις δεν ενεργοποιήθηκαν. Δοκίμασε ξανά."],
    ];
    for (const [label, scenario, enableCalls, message] of failing) {
        await check(`enabling fails and says why: ${label}`, { status: OFF, ...scenario }, async (app) => {
            await app.clickToggle();
            await app.confirm();
            assert.equal((await app.modal()).open, false, "no password prompt");
            assert.equal(app.named("enable").length, enableCalls);
            const { on, key } = await app.state();
            assert.deepEqual({ on, key }, OFF_STATE);
            assert.deepEqual(await app.status(), { text: message, error: true });
        });
    }

    await check("a failed attempt's message goes away on the next try", { status: OFF, enable: (n) => (n === 1 ? reply(502, { ok: false, code: "UPSTREAM_ERROR" }) : reply(200, { ok: true })) }, async (app) => {
        await app.clickToggle();
        await app.confirm();
        assert.equal((await app.status()).error, true);
        await app.clickToggle();
        await app.confirm();
        assert.deepEqual(await app.status(), { text: "", error: false });
        assert.equal((await app.state()).on, true);
    });

    const later = (ms, answer) => () => new Promise((resolve) => setTimeout(() => resolve(answer()), ms));
    await check("the switch is locked while a request is in flight", { status: OFF, enable: later(1500, () => reply(200, { ok: true })) }, async (app) => {
        await app.clickToggle();
        await app.page.click("#appModalConfirm", { timeout: 3000 });
        await app.page.waitForTimeout(300);
        assert.equal(await app.page.isDisabled("#notificationToggleInput"), true);
        await app.page.click("#notificationToggle", { timeout: 3000, force: true });
        await app.page.waitForTimeout(300);
        assert.equal((await app.modal()).open, false, "no second dialog");
        await app.page.waitForTimeout(1600);
        assert.equal(app.named("enable").length, 1);
        assert.equal(app.named("disable").length, 0);
        assert.equal(await app.page.isDisabled("#notificationToggleInput"), false);
        assert.deepEqual(await app.state(), { on: true, key: "true", permissionCalls: 0 });
    });

    await check("a redraw during a pending switch-off does not leave it on", { cached: true, status: ON, disable: later(1800, () => reply(200, { ok: true })) }, async (app) => {
        assert.equal((await app.state()).on, true);
        await app.clickToggle();
        // A refresh that brought new data redraws the dashboard mid-request.
        await app.page.evaluate(async () => {
            const response = await fetch("https://uni-api.halalas-services.xyz/auth/session", { credentials: "include" });
            const { renderDashboardData } = await import("/js/main.js");
            renderDashboardData(await response.json(), true);
        });
        await app.page.waitForTimeout(300);
        assert.equal((await app.state()).on, false, "still off while the request runs");
        await app.page.waitForTimeout(2300);
        assert.equal(app.named("disable").length, 1);
        assert.deepEqual(await app.state(), { on: false, key: null, permissionCalls: 0 });
    });

    await check("switching off fails and says so", { cached: true, status: ON, disable: () => reply(500, { ok: false }) }, async (app) => {
        await app.clickToggle();
        await app.page.waitForTimeout(500);
        assert.deepEqual(await app.state(), { on: true, key: "true", permissionCalls: 0 });
        assert.deepEqual(await app.status(), { text: "Οι ειδοποιήσεις δεν απενεργοποιήθηκαν. Δοκίμασε ξανά.", error: true });
    });

    await check("a second dialog does not strand the first", { status: OFF }, async (app) => {
        const first = await app.page.evaluate(async () => {
            const { openAppModal, closeAppModal } = await import("/js/modal.js");
            const pending = openAppModal({ title: "α", message: "α" });
            openAppModal({ title: "β", message: "β" });
            const answer = await Promise.race([pending, new Promise((r) => setTimeout(() => r("stranded"), 600))]);
            closeAppModal(null);
            return answer;
        });
        assert.equal(first, null);
    });

    // The status answer was requested before the user touched the toggle and
    // arrives after they turned it on: it must not switch it back off.
    const slowOff = () => new Promise((resolve) => setTimeout(() => resolve(OFF()), 3200));
    await check("a late status answer does not undo the user's choice", { status: slowOff, enable: () => reply(200, { ok: true }) }, async (app) => {
        await app.clickToggle();
        await app.confirm();
        assert.deepEqual(await app.state(), { on: true, key: "true", permissionCalls: 0 });
        await app.page.waitForTimeout(2500);
        assert.equal(app.named("status").length, 1);
        assert.deepEqual(await app.state(), { on: true, key: "true", permissionCalls: 0 });
    });

    await browser.close();
    console.log(results.join("\n"));
    if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})();
