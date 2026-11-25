// Αθόρυβη ανανέωση: στο άνοιγμα και στην επιστροφή μετά από >15'.
// node tests/run.mjs refresh
const { chromium } = require("playwright");

// node tests/run.mjs passes the page URL as argv[2] and serves the site.
const SITE = process.argv[2];
const ORIGIN = new URL(SITE).origin;
const OUT = process.argv[3];

const grade = (code, title, g) => ({ courseCode: code, title, grade: g, isPassed: g >= 5, examPeriod: "Ιανουάριος 2026", semester: "Χειμερινό", ects: 6, units: 4, category: "Κορμός" });
const data = (official) => ({
    ok: true,
    user: { fullName: "ΤΕΣΤ ΦΟΙΤΗΤΗΣ", ID: "5199" },
    eduportalGrades: official,
    courses: [{ name: "ΗΥ-240 Δομές", overallGrade: "7", grades: [{ name: "Κουίζ", grade: 7 }] }],
    assignments: [],
});
const STALE = data([grade("ΗΥ-100", "Παλιό Μάθημα", 6)]);
const FRESH = data([grade("ΗΥ-100", "Παλιό Μάθημα", 6), grade("ΗΥ-118", "Νέο Μάθημα Μετά Το Login", 8)]);

let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`); if (!ok) failures++; };

async function open(browser, refreshReply) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => {
        localStorage.setItem("halalasRememberSession", "true");
        // Ρολόι με μετατόπιση, για να «περάσουν» 16 λεπτά χωρίς αναμονή.
        window.__offset = 0;
        const realNow = Date.now.bind(Date);
        Date.now = () => realNow() + window.__offset;
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const counts = { refresh: 0 };
    const statuses = [];
    await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await page.route(/uni-api\.halalas-services\.xyz/, async (route) => {
        const url = route.request().url();
        if (url.endsWith("/auth/session")) return route.fulfill({ json: STALE });
        if (url.endsWith("/auth/refresh")) {
            counts.refresh++;
            await new Promise((r) => setTimeout(r, 400));
            const [status, body] = refreshReply(counts.refresh);
            return route.fulfill({ status, json: body });
        }
        return route.fulfill({ json: { ok: true, entries: [], history: [], enabled: false, available: true, assignments: [] } });
    });
    await page.goto(SITE);
    await page.waitForFunction(() => document.getElementById("sdStudentID").textContent === "5199", null, { timeout: 15000 });
    // Καταγραφή όσων γράφει το status όσο τρέχει η αθόρυβη ανανέωση.
    await page.exposeFunction("__status", (t) => statuses.push(t));
    await page.evaluate(() => {
        const el = document.getElementById("dashboardStatus");
        new MutationObserver(() => window.__status(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
    });
    return { ctx, page, errors, counts, statuses };
}

const hasFresh = (page) => page.evaluate(() => document.body.textContent.includes("Νέο Μάθημα Μετά Το Login"));

(async () => {
    const browser = await chromium.launch();

    // 1. Άνοιγμα: δείχνει το στιγμιότυπο και φέρνει μόνο του τα φρέσκα.
    let t = await open(browser, () => [200, { ...FRESH, refreshed: { moodle: true, official: true }, officialRecent: false, officialRefreshable: true }]);
    await t.page.waitForTimeout(2500);
    check("άνοιγμα: ακριβώς ένα /auth/refresh", t.counts.refresh === 1, String(t.counts.refresh));
    check("άνοιγμα: φαίνεται ο βαθμός που βγήκε μετά το login", await hasFresh(t.page));
    check("αθόρυβη: κανένα «Ανανέωση δεδομένων...»", !t.statuses.some((s) => s.includes("Ανανέωση")), JSON.stringify(t.statuses));
    const btnEnabled = await t.page.$eval("#refreshBtn", (b) => !b.disabled);
    check("κουμπί ενεργό μετά", btnEnabled);

    // 2. Επιστροφή μετά από 5' — όχι νέα ανανέωση.
    await t.page.evaluate(() => { window.__offset = 5 * 60 * 1000; document.dispatchEvent(new Event("visibilitychange")); });
    await t.page.waitForTimeout(1000);
    check("επιστροφή μετά 5': καμία ανανέωση", t.counts.refresh === 1, String(t.counts.refresh));

    // 3. Επιστροφή μετά από 16' — ανανεώνει.
    await t.page.evaluate(() => { window.__offset = 16 * 60 * 1000; document.dispatchEvent(new Event("visibilitychange")); });
    await t.page.waitForTimeout(1500);
    check("επιστροφή μετά 16': μία ανανέωση", t.counts.refresh === 2, String(t.counts.refresh));

    // 4. Κουμπί όσο τρέχει ήδη μία: δεν ξεκινάει δεύτερη.
    await t.page.evaluate(() => { window.__offset = 40 * 60 * 1000; document.dispatchEvent(new Event("visibilitychange")); });
    await t.page.waitForTimeout(100);
    await t.page.evaluate(() => document.getElementById("refreshBtn").click()); // disabled → αγνοείται
    await t.page.waitForTimeout(1500);
    check("ταυτόχρονες: ένα μόνο request", t.counts.refresh === 3, String(t.counts.refresh));

    // 5. Χειροκίνητο κουμπί με officialRecent: καμία προειδοποίηση.
    t.counts.refresh = 0;
    await t.page.unroute(/uni-api\.halalas-services\.xyz/);
    await t.page.route(/uni-api\.halalas-services\.xyz/, (route) =>
        route.request().url().endsWith("/auth/refresh")
            ? route.fulfill({ json: { ...FRESH, refreshed: { moodle: true, official: false }, officialRecent: true, officialRefreshable: true } })
            : route.fulfill({ json: { ok: true, entries: [], history: [], enabled: false, available: true, assignments: [] } }));
    await t.page.evaluate(() => document.getElementById("refreshBtn").click());
    await t.page.waitForTimeout(800);
    const status = await t.page.$eval("#dashboardStatus", (e) => e.textContent.trim());
    check("officialRecent: χωρίς προειδοποίηση", status === "", status);
    check("χωρίς JS σφάλματα", t.errors.length === 0, t.errors.join(" | "));
    await t.page.screenshot({ path: `${OUT}/refresh-390.png` });
    await t.ctx.close();

    // 6. Αθόρυβη που αποτυγχάνει: κανένα μήνυμα, μένει το στιγμιότυπο.
    t = await open(browser, () => [500, { ok: false }]);
    await t.page.waitForTimeout(2000);
    const status2 = await t.page.$eval("#dashboardStatus", (e) => e.textContent.trim());
    check("αποτυχία αθόρυβης: κανένα μήνυμα", status2 === "", status2);
    check("αποτυχία αθόρυβης: dashboard στη θέση του", await t.page.evaluate(() => document.body.textContent.includes("Παλιό Μάθημα")));
    check("χωρίς JS σφάλματα (2)", t.errors.length === 0, t.errors.join(" | "));
    await t.ctx.close();

    // 7. Χωρίς κωδικό στον server: η αθόρυβη δεν προειδοποιεί, το κουμπί ναι.
    t = await open(browser, () => [200, { ...FRESH, refreshed: { moodle: true, official: false }, officialRecent: false, officialRefreshable: false }]);
    await t.page.waitForTimeout(2000);
    check("χωρίς κωδικό, αθόρυβη: κανένα μήνυμα", (await t.page.$eval("#dashboardStatus", (e) => e.textContent.trim())) === "");
    await t.page.evaluate(() => document.getElementById("refreshBtn").click());
    await t.page.waitForTimeout(1200);
    check("χωρίς κωδικό, κουμπί: εξηγεί", (await t.page.$eval("#dashboardStatus", (e) => e.textContent)).includes("δεν ανανεώθηκαν"));
    await t.ctx.close();

    // 9. Το eLearn δεν απάντησε: το λέει και στην αθόρυβη ανανέωση του
    // ανοίγματος — αλλιώς ένας βαθμός που ήδη βγήκε μοιάζει να μην υπάρχει
    // (έτσι χάθηκε ένας στις 2026-11-24).
    const ELEARN = "Το eLearn δεν απάντησε· οι βαθμοί του Moodle είναι από την τελευταία επιτυχή ανάγνωση.";
    const statusOf = (page) => page.evaluate(() => {
        const el = document.getElementById("dashboardStatus");
        return { text: el.textContent.trim(), error: el.classList.contains("is-error") };
    });
    t = await open(browser, () => [200, { ...STALE, refreshed: { moodle: false, official: true }, officialRecent: false, officialRefreshable: true }]);
    await t.page.waitForTimeout(2000);
    const s9 = await statusOf(t.page);
    check("eLearn σιωπηλό, άνοιγμα: το λέει", s9.text === ELEARN && s9.error, JSON.stringify(s9));
    await t.page.evaluate(() => document.getElementById("refreshBtn").click());
    await t.page.waitForTimeout(1200);
    const s9b = await statusOf(t.page);
    check("eLearn σιωπηλό, κουμπί: το λέει", s9b.text === ELEARN && s9b.error, JSON.stringify(s9b));
    await t.ctx.close();

    // 10. Δεν απάντησε κανένα από τα δύο: και τα δύο μηνύματα.
    t = await open(browser, () => [200, { ...STALE, refreshed: { moodle: false, official: false }, officialRecent: false, officialRefreshable: true }]);
    await t.page.waitForTimeout(800);
    await t.page.evaluate(() => document.getElementById("refreshBtn").click());
    await t.page.waitForTimeout(1200);
    const s10 = await statusOf(t.page);
    check("κανένα δεν απάντησε: και τα δύο", s10.text === `${ELEARN} Το eduportal δεν απάντησε· οι επίσημοι βαθμοί είναι από την τελευταία επιτυχή ανάγνωση.`, JSON.stringify(s10));
    await t.ctx.close();

    // 11. Μια επόμενη επιτυχημένη ανανέωση σβήνει το μήνυμα.
    t = await open(browser, (n) => [200, { ...FRESH, refreshed: { moodle: n > 1, official: true }, officialRecent: false, officialRefreshable: true }]);
    await t.page.waitForTimeout(2000);
    await t.page.evaluate(() => document.getElementById("refreshBtn").click());
    await t.page.waitForTimeout(1200);
    check("επόμενη επιτυχία: σβήνει", (await statusOf(t.page)).text === "");
    await t.ctx.close();

    // 8. Παλιά σύνδεση: login με μήνυμα που εξηγεί το γιατί.
    {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await ctx.addInitScript(() => localStorage.setItem("halalasRememberSession", "true"));
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
        await page.route(/uni-api\.halalas-services\.xyz/, (route) =>
            route.request().url().endsWith("/auth/session")
                ? route.fulfill({ status: 401, json: { ok: false, code: "RELOGIN_REQUIRED", message: "x" } })
                : route.fulfill({ json: { ok: true } }));
        await page.goto(SITE);
        await page.waitForSelector(".login-btn", { state: "visible", timeout: 15000 });
        await page.waitForTimeout(800);
        const msg = await page.evaluate(() => { const el = document.getElementById("loginStatus"); return el && !el.hidden ? el.textContent : ""; });
        check("παλιά σύνδεση: login με εξήγηση", msg.includes("Συνδέσου ξανά μία φορά"), msg);
        check("χωρίς JS σφάλματα (3)", errors.length === 0, errors.join(" | "));
        await page.screenshot({ path: `${OUT}/relogin-390.png` });
        await ctx.close();
    }

    await browser.close();
    console.log(failures ? `\n${failures} FAILED` : "\nALL OK");
    process.exit(failures ? 1 : 0);
})();
