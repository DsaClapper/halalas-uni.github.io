// Έλεγχος του «Τελευταίοι βαθμοί» με mock δεδομένα. Τρέχει μέσα στο
// playwright image: node latest.js <φάκελος frontend> <φάκελος screenshots>
const { chromium } = require("playwright");

// node tests/run.mjs passes the page URL as argv[2] and serves the site.
const SITE = process.argv[2];
const ORIGIN = new URL(SITE).origin;
const OUT = process.argv[3];

const og = (code, title, grade, isPassed, examPeriod, addedAt, semester = "Χειμερινό") =>
    ({ courseCode: code, title, grade, isPassed, examPeriod, addedAt, semester, ects: 6, units: 4, category: "Κορμός" });

function session(extra = []) {
    return {
        ok: true,
        user: { fullName: "ΤΕΣΤ ΦΟΙΤΗΤΗΣ", ID: "5199" },
        eduportalGrades: [
            og("ΗΥ-100", "Εισαγωγή στην Επιστήμη", 8, true, "Ιανουάριος 2023", "2023-02-10T10:00:00Z"),
            og("ΗΥ-110", "Απειροστικός Ι", 6.5, true, "Ιανουάριος 2023", "2023-02-15T10:00:00Z"),
            og("ΗΥ-120", "Ψηφιακή Σχεδίαση", 2, false, "Ιούνιος 2024", "2024-07-01T10:00:00Z", "Εαρινό"),
            og("ΗΥ-150", "Προγραμματισμός", 6, true, "Σεπτέμβριος 2024", null), // ημερομηνία μόνο από ιστορικό
            og("ΗΥ-180", "Λογική", 7, true, "Ιανουάριος 2024", "2024-02-20T10:00:00Z"),
            og("ΗΥ-190", "Χωρίς ημερομηνία", 9, true, "Ιανουάριος 2022", null),
            og("ΗΥ-200", "Χωρίς βαθμό", null, false, null, null),
            ...extra,
        ],
        courses: [
            {
                name: "ΗΥ-240 Δομές Δεδομένων", overallGrade: "7.5",
                grades: [
                    { name: "Κουίζ 1", grade: 8, gradedAt: "2026-10-01T10:00:00Z" },
                    { name: "Κουίζ 2", grade: 4.5, gradedAt: "2026-10-12T10:00:00Z" },
                    { name: "Εργασία 1", grade: null, gradedAt: null },
                    {},
                ],
            },
            {
                name: "ΗΥ-252 Αντικειμενοστρεφής", overallGrade: null,
                grades: [{ name: "Άσκηση 1", grade: 9.25, gradedAt: "2026-10-15T10:00:00Z" }, { name: "Άσκηση 0", grade: 10, gradedAt: null }],
            },
        ],
        assignments: [],
    };
}

const history = {
    ok: true, enabled: true,
    history: [
        { at: "2024-10-01T10:00:00Z", type: "retake", courseCode: "ΗΥ-150", title: "Προγραμματισμός", examPeriod: "Σεπτέμβριος 2024", grade: 6, isPassed: true, from: 3.5 },
        { at: "2024-03-01T10:00:00Z", type: "new", courseCode: "ΗΥ-150", title: "Προγραμματισμός", examPeriod: "Φεβρουάριος 2024", grade: 3.5, isPassed: false },
        { at: "2023-07-01T10:00:00Z", type: "new", courseCode: "ΗΥ-150", title: "Προγραμματισμός", examPeriod: "Ιούνιος 2023", grade: 2, isPassed: false },
    ],
};

let failures = 0;
function check(name, ok, detail = "") {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
    if (!ok) failures++;
}

async function openPage(context, data) {
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
    page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text()); });
    await page.route("https://uni-api.halalas-services.xyz/**", (route) => {
        const url = route.request().url();
        const headers = { "access-control-allow-origin": ORIGIN, "access-control-allow-credentials": "true", "content-type": "application/json" };
        let body = { ok: true };
        if (url.includes("/auth/session") || url.includes("/auth/refresh")) body = { ...data, refreshed: { moodle: true, official: true } };
        else if (url.includes("/history/eduportal")) body = history;
        else if (url.includes("/assignments")) body = { ok: true, available: true, assignments: [] };
        route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
    });
    await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await page.goto(SITE);
    await page.waitForSelector("#tabBtnGrades", { state: "visible", timeout: 15000 }).catch(async (e) => {
        await page.screenshot({ path: `${OUT}/debug.png` });
        throw e;
    });
    await page.click("#tabBtnGrades");
    await page.waitForSelector("#sdLatestGrades:not([hidden])");
    await page.waitForFunction(() => document.querySelector(".sd-attempts"));
    return page;
}

const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));

(async () => {
    const browser = await chromium.launch();
    const width = Number(process.env.VW || 1280);
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(() => localStorage.setItem("halalasRememberSession", "true"));

    // 1η επίσκεψη
    let page = await openPage(context, session());
    const official = await texts(page, "#sdLatestOfficial .sd-latest-course");
    check("επίσημοι: 5 γραμμές", official.length === 5, official.join(" | "));
    check("επίσημοι: σειρά κατά ημερομηνία, με το ιστορικό για ΗΥ-150",
        official[0].startsWith("Προγραμματισμός") && official[1].startsWith("Ψηφιακή") && official[2].startsWith("Λογική"), official.join(" | "));
    check("επίσημοι: χωρίς βαθμό δεν εμφανίζεται", !official.some((t) => t.includes("Χωρίς βαθμό")));
    const prev = await texts(page, "#sdLatestOfficial .sd-latest-previous");
    check("προηγούμενη στην επανεξέταση", prev.length === 1 && prev[0] === "προηγούμενη: 3.5", prev.join("|"));
    check("κόπια με κόκκινο", (await page.$$("#sdLatestOfficial .sd-latest-grade.is-failed")).length === 1);
    const moodle = await texts(page, "#sdLatestMoodle .sd-latest-detail");
    check("moodle: σειρά, χωρίς αβαθμολόγητα/σύνολα, αχρονολόγητα στο τέλος",
        JSON.stringify(moodle) === JSON.stringify(["Άσκηση 1", "Κουίζ 2", "Κουίζ 1", "Άσκηση 0"]), JSON.stringify(moodle));
    check("1η επίσκεψη: κανένα «Νέο»", (await page.$$(".sd-latest-new")).length === 0);
    const attempts = await texts(page, ".sd-attempts");
    check("γραμμή προσπαθειών μόνο στο ΗΥ-150", attempts.length === 1 && /2.*→.*3\.5.*→.*6/.test(attempts[0]), attempts.join("|"));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("χωρίς οριζόντιο scroll", overflow <= 0, String(overflow));
    await page.screenshot({ path: `${OUT}/latest-${width}.png`, fullPage: false });
    await page.locator("#sdLatestGrades").screenshot({ path: `${OUT}/frame-${width}.png` });
    if (width < 600) {
        const cols = await page.$$eval(".sd-latest-col", (els) => els.map((e) => e.getBoundingClientRect().top));
        check("κινητό: στήλες η μία κάτω από την άλλη", cols[1] > cols[0]);
    }

    // Κλικ σε Moodle βαθμό → κάρτα ανοιχτή, τονισμένη, ορατή
    await page.click("#sdLatestMoodle .sd-latest-item >> nth=1");
    await page.waitForTimeout(700);
    const card = await page.$eval(".sd-course-card.is-flash", (c) => {
        const r = c.getBoundingClientRect();
        return { key: c.dataset.key, expanded: c.classList.contains("expanded"), visible: r.top < innerHeight && r.bottom > 0 };
    }).catch(() => null);
    check("κλικ → κάρτα ΗΥ-240 ανοιχτή και ορατή", card && card.key === "ΗΥ-240" && card.expanded && card.visible, JSON.stringify(card));

    // Κλικ όταν τα φίλτρα κρύβουν την κάρτα
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click('#gradesStatusChips [data-status="passed"]');
    await page.click("#sdLatestOfficial .sd-latest-item >> nth=1"); // ΗΥ-120, κόπια
    await page.waitForTimeout(700);
    const hidden = await page.$eval(".sd-course-card.is-flash", (c) => c.dataset.key).catch(() => null);
    check("κλικ σε κρυμμένη από φίλτρο κάρτα → φίλτρα καθαρίζουν", hidden === "ΗΥ-120", String(hidden));
    await page.close();

    // 2η επίσκεψη με έναν καινούργιο βαθμό
    page = await openPage(context, session([og("ΗΥ-210", "Διακριτά", 7.5, true, "Ιούνιος 2026", "2026-07-05T10:00:00Z", "Εαρινό")]));
    const news = await page.$$eval(".sd-latest-new", (els) => els.map((e) => e.closest(".sd-latest-course").textContent.trim()));
    check("2η επίσκεψη: «Νέο» μόνο στον καινούργιο", news.length === 1 && news[0].startsWith("Διακριτά"), JSON.stringify(news));
    await page.locator("#sdLatestGrades").screenshot({ path: `${OUT}/frame-new-${width}.png` });
    // Re-render (φίλτρο) δεν σβήνει το «Νέο» μέσα στην ίδια επίσκεψη
    await page.click('#gradesStatusChips [data-status="all"]');
    check("re-render κρατάει το «Νέο»", (await page.$$(".sd-latest-new")).length === 1);
    await page.close();

    page = await openPage(context, session([og("ΗΥ-210", "Διακριτά", 7.5, true, "Ιούνιος 2026", "2026-07-05T10:00:00Z", "Εαρινό")]));
    check("3η επίσκεψη: το «Νέο» έφυγε", (await page.$$(".sd-latest-new")).length === 0);

    await browser.close();
    console.log(failures ? `\n${failures} FAILED` : "\nall passed");
    process.exit(failures ? 1 : 0);
})();
