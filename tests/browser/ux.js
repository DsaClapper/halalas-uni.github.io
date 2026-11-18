// Grades sections/filters + assignments-by-course, on an iPhone-sized viewport,
// with mocked API data. Run twice: with curriculumSemester (semester grouping)
// and without it (fallback to Τρέχοντα / Παλαιότερα).
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

// node tests/run.mjs passes the page URL as argv[2].
const SITE = process.argv[2];
const DAY = 864e5;
const now = Date.now();

const titles = [
    "Εισαγωγή στην Επιστήμη Υπολογιστών", "Προγραμματισμός", "Διακριτά Μαθηματικά", "Απειροστικός Λογισμός Ι",
    "Αγγλικά Ι", "Δομές Δεδομένων", "Λογική Σχεδίαση", "Γραμμική Άλγεβρα", "Πιθανότητες", "Αγγλικά ΙΙ",
    "Οργάνωση Υπολογιστών", "Αλγόριθμοι", "Θεωρία Υπολογισμού", "Λειτουργικά Συστήματα", "Βάσεις Δεδομένων",
    "Δίκτυα Υπολογιστών", "Αριθμητική Ανάλυση", "Τεχνολογία Λογισμικού", "Γραφικά", "Μεταγλωττιστές",
    "Τεχνητή Νοημοσύνη", "Κρυπτογραφία", "Ασφάλεια Συστημάτων", "Μηχανική Μάθηση", "Παράλληλα Συστήματα",
];

function makeData(withSemester) {
    const official = titles.map((title, i) => {
        const semester = Math.floor(i / 4) + 1; // 1..7
        const passed = i < 15 ? i % 7 !== 3 : false;
        return {
            courseCode: `ΗΥ-${100 + i * 10}`,
            title,
            grade: passed ? 5 + (i % 5) : i % 7 === 3 ? 3 : null,
            isPassed: passed,
            ects: 6,
            ...(withSemester ? { semester: semester % 2 ? "Χειμερινό" : "Εαρινό" } : {}),
            category: i % 3 === 0 ? "Επιλογής" : "Υποχρεωτικό",
        };
    });
    // 13 current (Moodle) courses: the last 13 official ones.
    const courses = official.slice(12).map((c) => ({ name: `${c.courseCode} ${c.title}`, overallGrade: "-", grades: [] }));
    const a = (name, code, dueInDays, extra = {}) => ({
        id: name, name, courseId: code, courseName: `${code} ${titles[(Number(code.slice(3)) - 100) / 10]}`,
        moduleName: "assign", dueAt: new Date(now + dueInDays * DAY).toISOString(),
        submitted: false, overdue: dueInDays < 0, url: "https://elearn.uoc.gr/mod/assign/view.php?id=1", ...extra,
    });
    const assignments = [
        a("Άσκηση 1", "ΗΥ-240", -1),
        a("Άσκηση 2", "ΗΥ-240", 5),
        a("Project", "ΗΥ-240", 20),
        a("Σειρά 3", "ΗΥ-150", 1),
        a("Σειρά 4", "ΗΥ-150", 9),
        a("Lab 2", "ΗΥ-200", 3),
        a("Lab 3", "ΗΥ-200", 10),
        a("Lab 1", "ΗΥ-200", -3, { submitted: true }),
        a("Εργασία", "ΗΥ-180", 12),
        a("Quiz", "ΗΥ-180", 2),
    ];
    return {
        ok: true,
        user: { firstName: "ΝΙΚΟΛΑΟΣ ΧΡΗΣΤΟΣ", lastName: "ΜΑΡΑΓΚΟΣ", fullName: "ΜΑΡΑΓΚΟΣ ΝΙΚΟΛΑΟΣ ΧΡΗΣΤΟΣ", ID: "5964" },
        courses, eduportalGrades: official, assignments,
    };
}

async function openApp(browser, data, storage = {}) {
    const ctx = await browser.newContext({
        viewport: { width: Number(process.env.VW || 402), height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    });
    await ctx.addInitScript((storage) => {
        localStorage.setItem("halalasRememberSession", "true");
        for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    }, storage);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(/uni-api\.halalas-services\.xyz/, (route) =>
        /\/auth\/(session|refresh)$/.test(route.request().url())
            ? route.fulfill({ json: data })
            : route.fulfill({ json: { ok: true, entries: [], history: [], enabled: false } }),
    );
    await page.goto(SITE);
    await page.waitForFunction(() => document.getElementById("sdStudentID").textContent === "5964", null, { timeout: 15000 });
    await page.waitForTimeout(3500);
    return { ctx, page, errors };
}

const visibleCards = (page) =>
    page.evaluate(() =>
        [...document.querySelectorAll("#sdGradesGrid .sd-course-card")]
            .filter((c) => c.closest("details").open)
            .map((c) => c.querySelector(".sd-course-code").textContent.replace(/[()]/g, "")),
    );
const sectionInfo = (page) =>
    page.evaluate(() =>
        [...document.querySelectorAll("#sdGradesGrid details")].map((d) => ({
            title: d.querySelector(".sd-grade-section-title").textContent,
            facts: d.querySelector(".sd-grade-section-facts").textContent.replace(/\s+/g, " ").trim(),
            open: d.open,
        })),
    );
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

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

    // ---------- with curriculum semester ----------
    {
        const { ctx, page, errors } = await openApp(browser, makeData(true));
        await page.getByRole("tab", { name: "Βαθμοί" }).or(page.getByRole("button", { name: "Βαθμοί" })).first().click();
        await page.waitForTimeout(300);

        await check("sections: Χειμερινό then Εαρινό, current courses first inside each", async () => {
            const s = await sectionInfo(page);
            assert.deepEqual(s.map((x) => x.title), ["Χειμερινό εξάμηνο", "Εαρινό εξάμηνο"]);
            assert.deepEqual(s.map((x) => x.open), [true, true]);
            assert.match(s[0].facts, /13 μαθ\./); // semesters 1,3,5,7 → 4+4+4+1
            assert.match(s[1].facts, /12 μαθ\./);
            assert.match(s[0].facts, /ΜΟ \d\.\d\d/);
            const codes = await page.$$eval("#sdGradesGrid details:first-of-type .sd-course-code", (x) => x.map((e) => e.textContent.replace(/[()]/g, "")));
            const current = new Set(Array.from({ length: 13 }, (_, k) => `ΗΥ-${100 + (k + 12) * 10}`));
            const flags = codes.map((c) => current.has(c));
            assert.equal(flags.indexOf(false), flags.filter(Boolean).length, `current not first: ${codes.join(",")}`);
        });
        await page.waitForTimeout(350), await page.screenshot({ path: "/work/out/ux-grades-semesters.png" });

        await check("mobile filter bar: all chips fully visible, bar compact", async () => {
            const m = await page.evaluate(() => ({
                chips: [...document.querySelectorAll("#gradesStatusChips .sd-chip")].map((c) => {
                    const r = c.getBoundingClientRect();
                    return r.left >= 0 && r.right <= window.innerWidth;
                }),
                height: document.getElementById("gradesFilterBar").getBoundingClientRect().height,
            }));
            assert.deepEqual(m.chips, [true, true, true, true]);
            assert.ok(m.height <= 110, `filter bar is ${m.height}px tall`);
        });

        await check("status chips show counts", async () => {
            const chips = await page.$$eval("#gradesStatusChips .sd-chip", (cs) => cs.map((c) => c.textContent.replace(/\s+/g, " ").trim()));
            assert.deepEqual(chips, ["Όλα 25", "Τρέχοντα 13", "Περασμένα 13", "Χρωστούμενα 12"]);
        });

        await check("search is accent/case-insensitive and opens matching sections", async () => {
            await page.fill("#gradesSearch", "δομες");
            await page.waitForTimeout(150);
            assert.deepEqual(await visibleCards(page), ["ΗΥ-150"]);
            await page.fill("#gradesSearch", "ηυ-24");
            await page.waitForTimeout(150);
            assert.deepEqual(await visibleCards(page), ["ΗΥ-240"]);
            await page.fill("#gradesSearch", "");
        });

        await check("Χρωστούμενα shows only not-passed with an official record", async () => {
            await page.click('#gradesStatusChips [data-status="owed"]');
            const chipState = await page.$$eval("#gradesStatusChips .sd-chip", (cs) =>
                cs.map((c) => ({ s: c.dataset.status, active: c.classList.contains("is-active"), border: getComputedStyle(c).borderColor, focus: c === document.activeElement })),
            );
            assert.deepEqual(chipState.filter((c) => c.active).map((c) => c.s), ["owed"]);
            const cards = await visibleCards(page);
            assert.equal(cards.length, 12);
            const statuses = await page.$$eval("#sdGradesGrid .sd-course-status", (s) => [...new Set(s.map((x) => x.textContent))]);
            assert.deepEqual(statuses, ["Σε εκκρεμότητα"]);
        });
        await page.waitForTimeout(350), await page.screenshot({ path: "/work/out/ux-grades-owed.png" });

        await check("category filter combines with status, and filter is remembered", async () => {
            await page.selectOption("#gradesCategoryFilter", "Επιλογής");
            const n = (await visibleCards(page)).length;
            assert.ok(n > 0 && n < 12, `got ${n}`);
            const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("halalas_grades_filters")));
            assert.deepEqual(saved, { status: "owed", category: "Επιλογής" });
        });

        await check("no matches → message + reset button restores everything", async () => {
            await page.fill("#gradesSearch", "zzzz");
            await page.waitForTimeout(150);
            assert.match(await page.textContent("#sdGradesGrid"), /Κανένα μάθημα δεν ταιριάζει/);
            await page.click("#gradesResetFilters");
            assert.equal((await sectionInfo(page)).length, 2);
            assert.equal(await page.inputValue("#gradesSearch"), "");
        });

        await check("filter bar stays visible while scrolling (sticky)", async () => {
            await page.click('#gradesStatusChips [data-status="all"]');
            await page.evaluate(() => document.querySelectorAll("#sdGradesGrid details").forEach((d) => (d.open = true)));
            await page.evaluate(() => (document.querySelector(".sd-content").scrollTop = 1500));
            await page.waitForTimeout(400);
            const { bar, content } = await page.evaluate(() => ({
                bar: document.getElementById("gradesFilterBar").getBoundingClientRect().top,
                content: document.querySelector(".sd-content").getBoundingClientRect().top,
            }));
            assert.ok(Math.abs(bar - content) <= 2, `bar top ${bar}, scroll area top ${content}`);
        });
        await page.waitForTimeout(350), await page.screenshot({ path: "/work/out/ux-grades-sticky.png" });

        await check("user's open/closed choice survives a re-render", async () => {
            await page.evaluate(() => (document.querySelector(".sd-content").scrollTop = 0));
            await page.evaluate(() => {
                const d = document.querySelectorAll("#sdGradesGrid details");
                d.forEach((x) => (x.open = false));
                d[1].open = true;
            });
            await page.waitForTimeout(100);
            await page.click('#gradesStatusChips [data-status="all"]'); // triggers renderGrades
            const open = (await sectionInfo(page)).map((x) => x.open);
            assert.deepEqual(open, [false, true]);
        });

        await check("card shows pending count and jumps to filtered assignments", async () => {
            await page.evaluate(() => document.querySelectorAll("#sdGradesGrid details").forEach((d) => (d.open = true)));
            const link = page.locator(".sd-course-card", { hasText: "ΗΥ-240" }).locator(".sd-pending-link");
            assert.equal((await link.textContent()).trim(), "3 εκκρεμότητες"); // overdue counts, like the tab badge
            await link.click();
            await page.waitForTimeout(300);
            assert.equal(await page.inputValue("#assignmentsCourseFilter"), "ΗΥ-240");
            const names = await page.$$eval("#sdAssignmentsList .sd-assignment-name", (n) => n.map((x) => x.textContent));
            assert.deepEqual(names.sort(), ["Project", "Άσκηση 1", "Άσκηση 2"].sort());
        });
        await page.waitForTimeout(350), await page.screenshot({ path: "/work/out/ux-assignments-filtered.png" });

        await check("by-course view: most urgent course first, items by urgency", async () => {
            await page.selectOption("#assignmentsCourseFilter", "");
            await page.click('#tabAssignments [data-view="course"]');
            const groups = await page.$$eval("#sdAssignmentsList .sd-course-group", (gs) =>
                gs.map((g) => ({
                    name: g.querySelector(".sd-course-group-name").textContent,
                    items: [...g.querySelectorAll(".sd-assignment-name")].map((x) => x.textContent),
                    next: g.querySelector(".sd-course-group-next")?.textContent ?? "",
                    courseLineShown: Boolean(g.querySelector(".sd-assignment-course")),
                })),
            );
            assert.deepEqual(groups.map((g) => g.name.split(" ")[0]), ["ΗΥ-240", "ΗΥ-150", "ΗΥ-180", "ΗΥ-200"]);
            assert.deepEqual(groups[0].items, ["Άσκηση 1", "Άσκηση 2", "Project"]);
            assert.deepEqual(groups[2].items, ["Quiz", "Εργασία"]);
            assert.ok(groups.every((g) => !g.courseLineShown), "course name repeated in rows");
            assert.ok(groups.every((g) => g.next.startsWith("επόμενη:")));
        });
        await page.waitForTimeout(350), await page.screenshot({ path: "/work/out/ux-assignments-by-course.png" });

        await check("active segment is visibly different from inactive", async () => {
            const bg = await page.$$eval("#tabAssignments .sd-segment", (b) => b.map((x) => getComputedStyle(x).backgroundColor));
            assert.notEqual(bg[0], bg[1]);
        });

        await check("no horizontal overflow, no page errors", async () => {
            assert.ok(await noOverflow(page));
            assert.deepEqual(errors, []);
        });
        await ctx.close();
    }

    // ---------- view preference persists across reload ----------
    {
        const { ctx, page, errors } = await openApp(browser, makeData(true), { halalas_assignments_view: "course" });
        await check("assignments view is remembered", async () => {
            assert.ok((await page.$$("#sdAssignmentsList .sd-course-group")).length > 0);
            assert.equal(await page.getAttribute('#tabAssignments [data-view="course"]', "aria-pressed"), "true");
            assert.deepEqual(errors, []);
        });
        await ctx.close();
    }

    // ---------- fallback: no curriculumSemester ----------
    {
        const { ctx, page, errors } = await openApp(browser, makeData(false));
        await page.getByRole("tab", { name: "Βαθμοί" }).or(page.getByRole("button", { name: "Βαθμοί" })).first().click();
        await page.waitForTimeout(300);
        await check("fallback groups: Τρέχοντα open, Παλαιότερα closed", async () => {
            const s = await sectionInfo(page);
            assert.deepEqual(s.map((x) => [x.title, x.open]), [["Τρέχοντα μαθήματα", true], ["Παλαιότερα", false]]);
            assert.ok(await noOverflow(page));
            assert.deepEqual(errors, []);
        });
        await page.waitForTimeout(350), await page.screenshot({ path: "/work/out/ux-grades-fallback.png" });
        await ctx.close();
    }

    await browser.close();
    console.log(results.join("\n"));
    process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
})();
