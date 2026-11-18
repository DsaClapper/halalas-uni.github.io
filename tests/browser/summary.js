// The summary strip and the per-section facts must follow eduportal's own
// flags: a course can be passed and still not count in the degree average
// (countsTowardDegreeGrade: false) or not count toward the diploma's ECTS
// (countsTowardDiploma: false). Mocked API data, iPhone-sized viewport.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

// node tests/run.mjs passes the page URL as argv[2].
const SITE = process.argv[2];

const course = (n, grade, extra = {}) => ({
    courseCode: `ΗΥ-${100 + n * 10}`, title: `Μάθημα ${n}`, grade, isPassed: true, ects: 6,
    semester: "Χειμερινό", category: "Υποχρεωτικό", ...extra,
});
const makeData = (official) => ({
    ok: true,
    user: { firstName: "ΔΟΚΙΜΗ", lastName: "ΧΡΗΣΤΗΣ", fullName: "ΧΡΗΣΤΗΣ ΔΟΚΙΜΗ", ID: "1234" },
    courses: [], eduportalGrades: official, assignments: [],
});

async function openApp(browser, data) {
    const ctx = await browser.newContext({
        viewport: { width: Number(process.env.VW || 390), height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    });
    await ctx.addInitScript(() => localStorage.setItem("halalasRememberSession", "true"));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(/uni-api\.halalas-services\.xyz/, (route) =>
        /\/auth\/(session|refresh)$/.test(route.request().url())
            ? route.fulfill({ json: data })
            : route.fulfill({ json: { ok: true, entries: [], history: [], enabled: false } }),
    );
    await page.goto(SITE);
    await page.waitForFunction(() => document.getElementById("sdStudentID").textContent === "1234", null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.getByRole("tab", { name: "Βαθμοί" }).or(page.getByRole("button", { name: "Βαθμοί" })).first().click();
    await page.waitForTimeout(300);
    return { ctx, page, errors };
}

const read = (page) =>
    page.evaluate(() => ({
        average: document.getElementById("summaryAverage").textContent.trim(),
        passed: document.getElementById("summaryPassed").textContent.trim(),
        ects: document.getElementById("summaryEcts").textContent.trim(),
        facts: [...document.querySelectorAll("#sdGradesGrid .sd-grade-section-facts")].map((f) =>
            [...f.children].map((part) => part.textContent.replace(/\s+/g, " ").trim()).join(" | "),
        ),
        cards: Object.fromEntries(
            [...document.querySelectorAll("#sdGradesGrid .sd-course-card")].map((c) => [
                c.querySelector(".sd-course-code").textContent.replace(/[()]/g, ""),
                [...c.querySelectorAll(".sd-course-note")].map((n) => n.textContent.trim()),
            ]),
        ),
        text: document.getElementById("sdSummary").textContent + document.getElementById("sdGradesGrid").textContent + document.body.innerText,
    }));

(async () => {
    const browser = await chromium.launch();
    const results = [];
    const check = async (name, fn) => {
        try {
            await fn();
            results.push(`PASS  ${name}`);
        } catch (e) {
            results.push(`FAIL  ${name}\n      ${e.message.split("\n").slice(0, 4).join("\n      ")}`);
        }
    };
    const scenario = async (official) => {
        const { ctx, page, errors } = await openApp(browser, makeData(official));
        const seen = await read(page);
        await ctx.close();
        return { ...seen, errors };
    };

    // 10 and 8 count; the passed 6 does not; the failed 3 is not passed at all.
    const excluded = await scenario([
        course(1, 10), course(2, 8), course(3, 6, { countsTowardDegreeGrade: false }),
        course(4, 3, { isPassed: false, countsTowardDegreeGrade: false }),
    ]);
    await check("excluded course stays out of the average", async () => {
        assert.equal(excluded.average, "9.00");
        assert.equal(excluded.facts.length, 1);
        assert.match(excluded.facts[0], /ΜΟ 9\.00/);
        assert.deepEqual(excluded.errors, []);
    });
    await check("passed count is unchanged", async () => {
        assert.equal(excluded.passed, "3/4");
    });
    await check("excluded passed course is labelled", async () => {
        assert.deepEqual(excluded.cards, { "ΗΥ-110": [], "ΗΥ-120": [], "ΗΥ-130": ["εκτός Μ.Ο."], "ΗΥ-140": [] });
    });

    const diploma = await scenario([course(1, 10), course(2, 8), course(3, 6, { countsTowardDiploma: false })]);
    await check("diploma flag drives ECTS", async () => {
        assert.equal(diploma.ects, "12");
        assert.match(diploma.facts[0], /\| 12 ECTS$/);
        assert.equal(diploma.average, "8.00"); // still counts in the average
        assert.equal(diploma.passed, "3/3");
    });

    const plain = await scenario([course(1, 10), course(2, 8), course(3, 6)]);
    await check("missing flags count as before", async () => {
        assert.equal(plain.average, "8.00");
        assert.equal(plain.ects, "18");
        assert.match(plain.facts[0], /ΜΟ 8\.00/);
        assert.match(plain.facts[0], /\| 18 ECTS$/);
        assert.deepEqual(Object.values(plain.cards).flat(), []);
    });

    const none = await scenario([1, 2, 3].map((n) => course(n, 5 + n, { countsTowardDegreeGrade: false })));
    await check("all passed courses excluded", async () => {
        assert.equal(none.average, "—");
        assert.doesNotMatch(none.text, /NaN/);
        assert.doesNotMatch(none.facts[0], /ΜΟ/);
        assert.equal(none.passed, "3/3");
        assert.equal(none.ects, "18");
        assert.deepEqual(none.errors, []);
    });

    await browser.close();
    console.log(results.join("\n"));
    if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})();
