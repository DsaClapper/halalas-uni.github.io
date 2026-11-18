// Η καρτέλα «Αρχεία» με mock uni-api. Τρέχει μέσα στο playwright image:
// node tests/run.mjs files   (VW=390|1280)
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

// node tests/run.mjs passes the page URL as argv[2] and serves the site.
const SITE = process.argv[2];
const ORIGIN = new URL(SITE).origin;
const OUT = process.argv[3];
const API = "https://uni-api.halalas-services.xyz";

const session = {
    ok: true,
    user: { fullName: "ΤΕΣΤ ΦΟΙΤΗΤΗΣ", ID: "5199" },
    eduportalGrades: [],
    courses: [{ name: "ΗΥ-240 Δομές Δεδομένων", overallGrade: null, grades: [] }],
    assignments: [],
};

const COURSES = [
    { courseId: 11, name: "ΗΥ-240 Δομές Δεδομένων", isPast: false },
    { courseId: 12, name: "ΗΥ-252 Αντικειμενοστρεφής", isPast: false },
    { courseId: 5, name: "ΗΥ-100 Εισαγωγή", isPast: true },
];
const f = (id, courseId, section, sectionOrder, name, kind, addedAt, source = "course", assignmentName) => ({
    id, courseId, section, sectionOrder, name, kind, mimetype: "application/octet-stream", size: 123456, addedAt, source,
    ...(assignmentName ? { assignmentName } : {}),
});
const FILES = [
    f("f1", 11, "Διαλέξεις", 1, "Διάλεξη 1.pdf", "pdf", "2026-09-20T10:00:00Z"),
    f("f2", 11, "Διαλέξεις", 1, "Διάλεξη 2.pptx", "powerpoint", "2026-10-01T10:00:00Z"),
    f("f3", 11, "Ασκήσεις", 2, "Άσκηση 3.pdf", "pdf", "2026-10-15T10:00:00Z"),
    f("f4", 11, "Εργασίες", 1000000, "Εκφώνηση Εργασίας 1.pdf", "pdf", "2026-10-05T10:00:00Z", "assignment", "Εργασία 1"),
    f("f5", 11, "Οι υποβολές μου", 1000001, "lysi.zip", "other", "2026-10-18T10:00:00Z", "submission", "Εργασία 1"),
    f("f6", 12, "Γενικά", 0, "Οδηγός.docx", "word", null),
    f("f7", 5, "Υλικό", 1, "Παλιό.pdf", "pdf", "2023-01-01T10:00:00Z"),
];
const ok = (files = FILES, courses = COURSES, partial = []) =>
    ({ status: 200, body: { ok: true, courses, files, partial, fetchedAt: new Date().toISOString() } });

// Ό,τι επιστρέφει το mock αυτή τη στιγμή — αλλάζει ανάμεσα στις επισκέψεις.
const mock = { files: ok(), linkFail: false };
const requests = [];

async function setupContext(browser, width) {
    const ctx = await browser.newContext({ viewport: { width, height: 860 } });
    await ctx.addInitScript(() => localStorage.setItem("halalasRememberSession", "true"));
    ctx.on("request", (r) => { if (r.url().startsWith(API)) requests.push(`${r.method()} ${r.url().slice(API.length)}`); });
    await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await ctx.route(`${API}/**`, (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const headers = { "access-control-allow-origin": ORIGIN, "access-control-allow-credentials": "true", "content-type": "application/json" };
        const json = (status, body) => route.fulfill({ status, headers, body: JSON.stringify(body) });
        const p = url.pathname;
        if (p.startsWith("/auth/files/dl/")) return route.fulfill({ status: 200, headers: { "content-type": "text/plain" }, body: "bytes" });
        const link = p.match(/^\/auth\/files\/([^/]+)\/link$/);
        if (link) {
            if (mock.linkFail) return json(404, { ok: false, code: "FILE_NOT_FOUND" });
            return json(200, { ok: true, view: `/auth/files/dl/T-${link[1]}`, download: `/auth/files/dl/T-${link[1]}?download=1` });
        }
        if (p === "/auth/files") return json(mock.files.status, mock.files.body);
        if (p === "/auth/session" || p === "/auth/refresh") return json(200, session);
        if (p.startsWith("/history")) return json(200, { ok: true, enabled: false, history: [] });
        return json(200, { ok: true });
    });
    return ctx;
}

async function openDashboard(ctx) {
    const page = await ctx.newPage();
    page.errors = [];
    page.on("pageerror", (e) => { page.errors.push(e.message); console.log("PAGEERROR", e.message); });
    await page.goto(SITE);
    await page.waitForSelector("#tabBtnGrades", { state: "visible", timeout: 15000 });
    return page;
}

async function openFilesTab(ctx, waitFor = "#sdFilesList .sd-file-row") {
    const page = await openDashboard(ctx);
    await page.click("#tabBtnFiles", { timeout: 3000 });
    await page.waitForSelector(waitFor, { timeout: 5000 });
    return page;
}

// Ονόματα αρχείων που φαίνονται πραγματικά (όχι μέσα σε κλειστό <details>).
const visibleNames = (page) => page.$$eval("#sdFilesList .sd-file-name", (els) =>
    els.filter((e) => e.getClientRects().length > 0).map((e) => e.firstChild.textContent.trim()));
const rowOf = (page, name) => page.locator("#sdFilesList .sd-file-row", { has: page.locator(".sd-file-name", { hasText: name }) });
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const filesRequests = () => requests.filter((r) => /^GET \/auth\/files(\?|$)/.test(r));

(async () => {
    const browser = await chromium.launch();
    const width = Number(process.env.VW || 1280);
    const results = [];
    const check = async (name, fn) => {
        try {
            await fn();
            results.push(`PASS  ${name}`);
        } catch (e) {
            results.push(`FAIL  ${name}\n      ${String(e.message).split("\n").slice(0, 4).join("\n      ")}`);
        }
    };
    const ctx = await setupContext(browser, width);
    let page = null;

    // ---------- 1η επίσκεψη ----------
    await check("1. δεν καλεί /auth/files πριν πατηθεί η καρτέλα", async () => {
        page = await openDashboard(ctx);
        await page.waitForTimeout(1500);
        assert.equal(filesRequests().length, 0, requests.join(", "));
        await page.click("#tabBtnFiles", { timeout: 3000 });
        await page.waitForSelector("#sdFilesList .sd-file-row", { timeout: 5000 });
        assert.equal(filesRequests().length, 1, filesRequests().join(", "));
        assert.equal(filesRequests()[0], "GET /auth/files");
    });

    await check("2. «Ανά μάθημα»: τρέχοντα ανοιχτά, παλιό κλειστό κάτω από «Παλαιότερα»", async () => {
        const state = await page.$$eval("#sdFilesList details[data-course-id]", (ds) => ds.map((d) => [d.dataset.courseId, d.open]));
        assert.deepEqual(state, [["11", true], ["12", true], ["5", false]]);
        assert.match(await page.textContent("#sdFilesList"), /Παλαιότερα/);
        await page.screenshot({ path: `${OUT}/files-${width}.png` });
    });

    await check("7a. πρώτο φόρτωμα: 0 σήματα «Νέο»", async () => {
        assert.equal(await page.locator("#sdFilesList .sd-file-new").count(), 0);
    });

    await check("9a. «Δικό μου» κάτω από την ίδια εργασία, χωρίς «Νέο»; καμία ενότητα «Οι υποβολές μου»", async () => {
        const course = page.locator('#sdFilesList details[data-course-id="11"]');
        const sections = await course.locator(".sd-files-section-title").allTextContents();
        assert.deepEqual(sections.map((s) => s.trim()), ["Διαλέξεις", "Ασκήσεις", "Εργασίες"]);
        const assignment = course.locator(".sd-files-assignment", { hasText: "Εργασία 1" });
        const names = await assignment.locator(".sd-file-name").evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim()));
        assert.deepEqual(names, ["Εκφώνηση Εργασίας 1.pdf", "lysi.zip"]);
        const mine = rowOf(page, "lysi.zip");
        assert.equal(await mine.locator(".sd-file-mine").count(), 1);
        assert.match(await mine.locator(".sd-file-mine").textContent(), /Δικό μου/);
        assert.equal(await mine.locator(".sd-file-new").count(), 0);
        assert.equal(await rowOf(page, "Εκφώνηση").locator(".sd-file-mine").count(), 0);
    });

    await check("3. αναζήτηση «ασκηση» βρίσκει το «Άσκηση 3.pdf»; τίποτα → μήνυμα", async () => {
        await page.fill("#filesSearch", "ασκηση");
        await page.waitForTimeout(150);
        assert.deepEqual(await visibleNames(page), ["Άσκηση 3.pdf"]);
        await page.fill("#filesSearch", "δομες"); // όνομα μαθήματος
        await page.waitForTimeout(150);
        assert.equal((await visibleNames(page)).length, 5);
        await page.fill("#filesSearch", "zzzz");
        await page.waitForTimeout(150);
        assert.match(await page.textContent("#sdFilesList"), /Κανένα αρχείο δεν ταιριάζει/);
        await page.fill("#filesSearch", "");
        await page.waitForTimeout(150);
    });

    await check("4. chip PDF κρύβει το .pptx (αριθμοί στα chips, δεύτερο πάτημα το βγάζει)", async () => {
        const chips = await page.$$eval("#filesKindChips .sd-chip", (cs) => cs.map((c) => c.textContent.replace(/\s+/g, " ").trim()));
        assert.deepEqual(chips, ["PDF 4", "Word 1", "PowerPoint 1", "Λοιπά 1"]);
        await page.click('#filesKindChips [data-kind="pdf"]');
        await page.waitForTimeout(150);
        let names = await visibleNames(page);
        assert.ok(!names.some((n) => n.endsWith(".pptx")), names.join("|"));
        assert.ok(names.includes("Άσκηση 3.pdf"), names.join("|"));
        assert.equal(await page.getAttribute('#filesKindChips [data-kind="pdf"]', "aria-pressed"), "true");
        await page.click('#filesKindChips [data-kind="pdf"]');
        await page.waitForTimeout(150);
        names = await visibleNames(page);
        assert.ok(names.includes("Διάλεξη 2.pptx"), names.join("|"));
    });

    await check("13a. καμία οριζόντια κύλιση (ανά μάθημα)", async () => {
        const o = await noOverflow(page);
        assert.ok(o <= 0, `overflow ${o}px`);
    });

    await check("5. «Νεότερα»: σειρά κατά ημερομηνία, χωρίς ημερομηνία στο τέλος, γραμμή με μάθημα", async () => {
        await page.click('#tabFiles .sd-segment[data-view="recent"]');
        await page.waitForTimeout(150);
        assert.deepEqual(await visibleNames(page), [
            "lysi.zip", "Άσκηση 3.pdf", "Εκφώνηση Εργασίας 1.pdf", "Διάλεξη 2.pptx", "Διάλεξη 1.pdf", "Παλιό.pdf", "Οδηγός.docx",
        ]);
        const meta = await rowOf(page, "Άσκηση 3.pdf").locator(".sd-file-meta").textContent();
        assert.match(meta, /Δομές Δεδομένων/);
        assert.match(meta, /2026/);
        const o = await noOverflow(page);
        assert.ok(o <= 0, `13b overflow ${o}px`);
        await page.screenshot({ path: `${OUT}/files-recent-${width}.png` });
    });

    await check("12. πάτημα → POST …/link και άνοιγμα view; εικονίδιο → download; σφάλμα → κλείνει + μήνυμα", async () => {
        const [popup] = await Promise.all([ctx.waitForEvent("page"), rowOf(page, "Άσκηση 3.pdf").locator(".sd-file-open").click()]);
        await popup.waitForURL(`${API}/auth/files/dl/T-f3`, { timeout: 5000 });
        assert.ok(requests.includes("POST /auth/files/f3/link"), requests.join(", "));
        await popup.close();
        const [popup2] = await Promise.all([ctx.waitForEvent("page"), rowOf(page, "Διάλεξη 1.pdf").locator(".sd-file-download").click()]);
        await popup2.waitForURL(`${API}/auth/files/dl/T-f1?download=1`, { timeout: 5000 });
        await popup2.close();
        mock.linkFail = true;
        const [popup3] = await Promise.all([ctx.waitForEvent("page"), rowOf(page, "Οδηγός.docx").locator(".sd-file-open").click()]);
        // Το παράθυρο μπορεί να έχει ήδη κλείσει πριν προλάβουμε να ακούσουμε.
        if (!popup3.isClosed()) await popup3.waitForEvent("close", { timeout: 5000 });
        await page.waitForSelector("#filesNote:not([hidden])", { timeout: 3000 });
        mock.linkFail = false;
    });

    await check("6. η εναλλαγή προβολής θυμάται μετά από reload", async () => {
        assert.equal(await page.evaluate(() => localStorage.getItem("halalas_files_view")), "recent");
        await page.reload();
        // Η καρτέλα θυμάται τον εαυτό της (sessionStorage), άρα ξαναφορτώνει μόνη της.
        await page.waitForSelector("#sdFilesList .sd-file-row", { timeout: 15000 });
        assert.equal(await page.getAttribute('#tabFiles .sd-segment[data-view="recent"]', "aria-pressed"), "true");
        assert.equal(await page.locator("#sdFilesList details[data-course-id]").count(), 0);
        await page.click('#tabFiles .sd-segment[data-view="course"]');
        assert.equal(await page.evaluate(() => localStorage.getItem("halalas_files_view")), "course");
        assert.deepEqual(page.errors, []);
    });
    if (page) await page.close();

    // ---------- 2η επίσκεψη: ένα νέο αρχείο μαθήματος + μια νέα δική μου υποβολή ----------
    mock.files = ok([
        ...FILES,
        f("f8", 11, "Ασκήσεις", 2, "Άσκηση 4.pdf", "pdf", "2026-10-24T10:00:00Z"),
        f("f9", 11, "Οι υποβολές μου", 1000001, "lysi-v2.zip", "other", "2026-10-24T11:00:00Z", "submission", "Εργασία 1"),
    ]);
    await check("7b. δεύτερο φόρτωμα με ένα νέο αρχείο: 1 σήμα «Νέο», στο σωστό", async () => {
        page = await openFilesTab(ctx);
        assert.equal(await page.locator("#sdFilesList .sd-file-new").count(), 1);
        assert.equal(await rowOf(page, "Άσκηση 4.pdf").locator(".sd-file-new").count(), 1);
    });
    await check("9b. νέα δική μου υποβολή: «Δικό μου», ποτέ «Νέο»", async () => {
        const row = rowOf(page, "lysi-v2.zip");
        assert.equal(await row.locator(".sd-file-mine").count(), 1);
        assert.equal(await row.locator(".sd-file-new").count(), 0);
        await page.screenshot({ path: `${OUT}/files-new-${width}.png` });
    });
    if (page) await page.close();

    // ---------- 3η επίσκεψη: καινούργιο μάθημα ----------
    mock.files = ok(
        [...mock.files.body.files, f("g1", 13, "Γενικά", 0, "Ύλη.pdf", "pdf", "2026-10-24T09:00:00Z"), f("g2", 13, "Γενικά", 0, "Πρόγραμμα.docx", "word", null)],
        [...COURSES, { courseId: 13, name: "ΗΥ-360 Αρχεία", isPast: false }],
    );
    await check("8. νέο μάθημα: 0 σήματα για τα αρχεία του", async () => {
        page = await openFilesTab(ctx);
        assert.equal(await page.locator('#sdFilesList details[data-course-id="13"] .sd-file-row').count(), 2);
        assert.equal(await page.locator('#sdFilesList details[data-course-id="13"] .sd-file-new').count(), 0);
        assert.equal(await page.locator("#sdFilesList .sd-file-new").count(), 0);
    });
    if (page) await page.close();

    // ---------- NEEDS_RELOGIN ----------
    mock.files = { status: 409, body: { ok: false, code: "NEEDS_RELOGIN" } };
    await check("10. NEEDS_RELOGIN: μήνυμα + κουμπί που κάνει logout και πάει στο login", async () => {
        page = await openFilesTab(ctx, "#filesReloginBtn");
        assert.match(await page.textContent("#sdFilesList"), /Για τα αρχεία χρειάζεται να συνδεθείς ξανά μία φορά/);
        await page.click("#filesReloginBtn");
        await page.waitForSelector("#loginWrapper", { state: "visible", timeout: 5000 });
        assert.ok(requests.includes("POST /auth/logout"), requests.join(", "));
    });
    if (page) await page.close();

    // ---------- partial ----------
    mock.files = ok(FILES.filter((x) => x.courseId !== 12), COURSES, ["course:12"]);
    await check("11. partial: προειδοποίηση «Κάποια αρχεία δεν φορτώθηκαν»", async () => {
        page = await openFilesTab(ctx);
        assert.match(await page.textContent("#tabFiles"), /Κάποια αρχεία δεν φορτώθηκαν/);
    });
    await check("extra. «Ανανέωση» ξαναφέρνει τη λίστα με ?refresh=1", async () => {
        mock.files = ok();
        // Στο κινητό το κουμπί κρύβεται (εκεί είναι pull-to-refresh, που
        // καλεί την ίδια ανανέωση)· το click() του DOM το πατάει και κρυφό.
        await page.evaluate(() => document.getElementById("refreshBtn").click());
        await page.waitForFunction(() => !document.getElementById("refreshBtn").disabled);
        await page.waitForTimeout(500);
        assert.ok(requests.includes("GET /auth/files?refresh=1"), filesRequests().join(", "));
        assert.ok(!/Κάποια αρχεία δεν φορτώθηκαν/.test(await page.textContent("#tabFiles")), "η προειδοποίηση έμεινε");
        assert.deepEqual(page.errors, []);
    });
    if (page) await page.close();

    await browser.close();
    console.log(`width ${width}`);
    console.log(results.join("\n"));
    const failed = results.filter((r) => r.startsWith("FAIL")).length;
    console.log(failed ? `\n${failed} FAILED` : "\nall passed");
    process.exit(failed ? 1 : 0);
})();
