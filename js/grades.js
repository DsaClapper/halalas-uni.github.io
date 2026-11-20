// js/grades.js — tabs και βαθμοί.
import { appState } from "./state.js";
import { escapeHtml } from "./util.js";
import { countsInAverage, countsInDiploma } from "./summary.js";
import { activePending, openAssignmentsFor } from "./assignments.js";
import { historyFilter, renderHistory } from "./history.js";
import { ensureFilesLoaded } from "./app.js";

// ------------------------------------------------------------------ Tabs
// Οι τέσσερις ενότητες έφταναν τις 6 οθόνες scroll σε κινητό με ανοιχτά
// όλα, και το ιστορικό ξεκινούσε στην 5η. Τρία panels, ένα κάθε φορά.
const DEFAULT_TAB = "tabAssignments";
const TAB_MEMORY_KEY = "halalas_active_tab";

function selectTab(panelId, { remember = true } = {}) {
    const target = document.getElementById(panelId) ? panelId : DEFAULT_TAB;

    document.querySelectorAll(".sd-tab").forEach((tab) => {
        const isActive = tab.dataset.panel === target;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", String(isActive));
    });
    document.querySelectorAll(".sd-tabpanel").forEach((panel) => {
        const isActive = panel.id === target;
        panel.classList.toggle("is-active", isActive);
        panel.hidden = !isActive;
    });

    // Αλλάζοντας tab το περιεχόμενο είναι καινούργιο· το να κρατήσουμε το
    // scroll του προηγούμενου θα σε πετούσε στη μέση μιας λίστας που δεν
    // ζήτησες.
    const content = document.querySelector(".sd-content");
    if (content) content.scrollTop = 0;

    // Τα αρχεία φορτώνονται την πρώτη φορά που τα κοιτάς, όχι πριν.
    if (target === "tabFiles") ensureFilesLoaded();

    // Μόνο για τη διάρκεια της καρτέλας του browser. Σε νέο άνοιγμα
    // ξεκινάς πάντα στις Εκκρεμότητες, που είναι το μόνο που αλλάζει
    // καθημερινά — το να σε υποδέχεται το ιστορικό επειδή το κοίταξες
    // κάποτε θα ήταν λάθος προεπιλογή.
    if (remember) {
        try {
            sessionStorage.setItem(TAB_MEMORY_KEY, target);
        } catch {
            // Ιδιωτική περιήγηση ή κλειδωμένο storage: δεν χαλάει τίποτα.
        }
    }
}

document.querySelectorAll(".sd-tab").forEach((tab) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.panel));
});

// Βέλη αριστερά/δεξιά μέσα στη μπάρα, όπως ορίζει το πρότυπο για tablist.
document.querySelector(".sd-tabs").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const tabs = [...document.querySelectorAll(".sd-tab")];
    const current = tabs.findIndex((tab) => tab.classList.contains("is-active"));
    const next = (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    selectTab(tabs[next].dataset.panel);
    event.preventDefault();
});

function restoreTab() {
    let saved = null;
    try {
        saved = sessionStorage.getItem(TAB_MEMORY_KEY);
    } catch {
        // αγνόησέ το
    }
    selectTab(saved || DEFAULT_TAB, { remember: false });
}

// ---------------------------------------------------------------- Βαθμοί
// Μία κάρτα ανά μάθημα, με όσες από τις δύο πηγές υπάρχουν.
//
// Ήταν δύο ξεχωριστές ενότητες, και αυτό ήταν μέρος του προβλήματος: το
// ίδιο μάθημα εμφανιζόταν δύο φορές με διαφορετικό αριθμό και τίποτα δεν
// έδενε τις δύο εμφανίσεις μεταξύ τους. Ενωμένες, η διαφορά φαίνεται στην
// ίδια γραμμή αντί να πρέπει να τη θυμάσαι ανάμεσα σε δύο οθόνες.
//
// Οι δύο πηγές δεν καλύπτουν τα ίδια μαθήματα: το Moodle έχει μόνο όσα
// παρακολουθείς τώρα, το eduportal όλα όσα πέρασαν ποτέ από την καρτέλα
// σου. Γι' αυτό η ένωση είναι σε δύο ομάδες και όχι σε μία λίστα.

// Το Moodle δίνει "ΗΥ-240 Δομές Δεδομένων", το eduportal "ΗΥ-240" χωριστά.
// Η παύλα δεν είναι πάντα η ίδια (- έναντι –), γι' αυτό κανονικοποιείται.
function courseKey(value) {
    if (!value) return "";
    const match = String(value).trim().match(/^([\p{L}\d]+\s*[-–—]\s*\d+)/u);
    return (match ? match[1] : String(value).trim())
        .replace(/[–—]/g, "-")
        .replace(/\s+/g, "")
        .toUpperCase();
}

function moodleTitleWithoutCode(name) {
    return String(name || "").replace(/^[\p{L}\d]+\s*[-–—]\s*\d+\s*/u, "").trim();
}

function mergeGradeSources(data) {
    const official = Array.isArray(data.eduportalGrades) ? data.eduportalGrades : [];
    const moodle = Array.isArray(data.courses) ? data.courses : [];

    const byCode = new Map();
    for (const course of official) {
        const key = courseKey(course.courseCode);
        if (key) byCode.set(key, { key, code: course.courseCode, official: course, moodle: null });
    }

    for (const course of moodle) {
        const key = courseKey(course.name);
        const existing = byCode.get(key);
        if (existing) {
            existing.moodle = course;
        } else {
            byCode.set(key, { key, code: key, official: null, moodle: course });
        }
    }

    const byCodeAsc = (a, b) =>
        String(a.code ?? "").localeCompare(String(b.code ?? ""), undefined, {
            numeric: true,
            sensitivity: "base",
        });

    const all = [...byCode.values()];
    return {
        current: all.filter((entry) => entry.moodle).sort(byCodeAsc),
        past: all.filter((entry) => !entry.moodle).sort(byCodeAsc),
    };
}

function gradeRow(label, value, isGood) {
    const known = value !== null && value !== undefined && value !== "";
    return `
        <div class="sd-overall-grade${known && isGood ? " has-grade" : ""}${known ? "" : " is-empty"}">
            <span>${escapeHtml(label)}</span>
            <span>${known ? escapeHtml(String(value)) : "—"}</span>
        </div>`;
}

function buildGradeCard(entry) {
    const official = entry.official;
    const moodle = entry.moodle;

    const title = official
        ? official.title
        : moodleTitleWithoutCode(moodle.name) || moodle.name;

    const card = document.createElement("div");
    card.className = "sd-course-card";
    card.dataset.key = entry.key;

    const meta = official
        ? [
              official.semester ? `Εξάμηνο: ${official.semester}` : "",
              official.examPeriod ? `Εξεταστική: ${official.examPeriod}` : "",
              official.units !== undefined ? `Μονάδες: ${official.units}` : "",
              official.ects !== undefined ? `ECTS: ${official.ects}` : "",
          ].filter(Boolean)
        : [];

    // Χωρίς επίσημη εγγραφή δεν υπάρχει «πέρασε/δεν πέρασε» να δηλωθεί:
    // το μάθημα απλώς τρέχει ακόμα.
    const status = official
        ? official.isPassed
            ? { label: "Πέρασε", cls: "is-passed" }
            : { label: "Σε εκκρεμότητα", cls: "is-pending" }
        : { label: "Σε εξέλιξη", cls: "is-running" };

    const moodleGrades = moodle && Array.isArray(moodle.grades)
        ? moodle.grades.filter((item) => item && Object.keys(item).length > 0 && item.name)
        : [];

    let html = `
        <div class="sd-card-header">
            <div class="sd-course-title">
                ${escapeHtml(title)}
                ${entry.code ? `<span class="sd-course-code">(${escapeHtml(entry.code)})</span>` : ""}
            </div>
            <div class="sd-grade-pair">
                ${gradeRow("Επίσημος:", official ? official.grade : null, Boolean(official && official.isPassed))}
                ${moodle ? gradeRow("Moodle:", moodle.overallGrade, true) : ""}
            </div>
            ${meta.length ? `<div class="sd-course-meta">${meta.map((m) => `<span>${escapeHtml(m)}</span>`).join("")}</div>` : ""}
            ${official ? attemptsLine(official.courseCode) : ""}
            <div class="sd-course-status ${status.cls}">${status.label}</div>
            ${official && official.isPassed && official.countsTowardDegreeGrade === false ? `<div class="sd-course-note" title="Δεν μετράει στον μέσο όρο πτυχίου">εκτός Μ.Ο.</div>` : ""}`;

    if (moodleGrades.length > 0) {
        html += `
            <div class="sd-toggle-hint">
                <span>Αναλυτική βαθμολογία Moodle</span>
                <svg class="sd-chevron" aria-hidden="true"><use href="#i-chevron-down"/></svg>
            </div>`;
    }

    // Πόσες εκκρεμότητες έχει το μάθημα, με σύνδεσμο στη λίστα τους
    // φιλτραρισμένη. Μετράει μόνο ό,τι μετράει και το σήμα του tab.
    const pendingHere = activePending().filter((a) => courseKey(a.courseName) === entry.key).length;
    const actions = [
        pendingHere > 0
            ? `<button class="sd-history-link sd-pending-link" type="button">${pendingHere} ${pendingHere === 1 ? "εκκρεμότητα" : "εκκρεμότητες"}</button>`
            : "",
        entry.official ? `<button class="sd-history-link sd-course-history-link" type="button">Ιστορικό μαθήματος</button>` : "",
    ].filter(Boolean);
    html += `
            ${actions.length ? `<div class="sd-card-links">${actions.join("")}</div>` : ""}
        </div>`;

    if (moodleGrades.length > 0) {
        html += `<div class="sd-grades-list">`;
        for (const item of moodleGrades) {
            const known = item.grade !== null && item.grade !== undefined;
            html += `
                <div class="sd-grade-item">
                    <span class="sd-grade-name">${escapeHtml(item.name)}</span>
                    <span class="sd-grade-value${known ? " has-grade" : ""}">${known ? escapeHtml(String(item.grade)) : "—"}</span>
                </div>`;
        }
        html += `</div>`;
    }

    card.innerHTML = html;

    const hint = card.querySelector(".sd-toggle-hint");
    if (hint) {
        const toggle = () => card.classList.toggle("expanded");
        hint.addEventListener("click", toggle);
        hint.setAttribute("tabindex", "0");
        hint.setAttribute("role", "button");
        hint.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggle();
            }
        });
    }

    const historyLink = card.querySelector(".sd-course-history-link");
    if (historyLink) {
        historyLink.addEventListener("click", () => openHistoryFor(official.courseCode));
    }
    const pendingLink = card.querySelector(".sd-pending-link");
    if (pendingLink) {
        pendingLink.addEventListener("click", () => openAssignmentsFor(entry.key));
    }

    return card;
}

// ------------------------------------------------------- Βαθμοί: προσπάθειες
// Από το ιστορικό, όχι από την τρέχουσα βαθμολογία: το /grades/diploma
// κρατάει μία γραμμή ανά μάθημα, οπότε μια κόπια που ξαναδόθηκε χάνεται
// από εκεί. Μία προσπάθεια ανά εξεταστική — μια διόρθωση μέσα στην ίδια
// εξεταστική αντικαθιστά τον βαθμό της, δεν είναι νέα προσπάθεια.
function courseAttempts(courseCode) {
    if (!appState.historyEnabled || !courseCode) return [];
    const byPeriod = new Map();
    for (const entry of appState.historyEntries) {
        if (entry.courseCode !== courseCode || typeof entry.grade !== "number") continue;
        const key = entry.examPeriod ?? "";
        const seen = byPeriod.get(key);
        if (!seen || String(entry.at).localeCompare(String(seen.at)) > 0) byPeriod.set(key, entry);
    }
    return [...byPeriod.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

function shortMonth(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("el-GR", { month: "short", year: "2-digit" }).format(date);
}

// Μόνο όταν υπάρχουν τουλάχιστον δύο· μία προσπάθεια είναι ήδη ο βαθμός
// της κάρτας.
function attemptsLine(courseCode) {
    const attempts = courseAttempts(courseCode);
    if (attempts.length < 2) return "";
    const parts = attempts.map((a) => {
        const when = shortMonth(a.at);
        return `<span class="sd-attempt ${a.isPassed ? "is-passed" : "is-failed"}"${
            a.examPeriod ? ` title="${escapeHtml(a.examPeriod)}"` : ""
        }>${escapeHtml(a.grade)}${when ? ` <small>(${escapeHtml(when)})</small>` : ""}</span>`;
    });
    return `<div class="sd-attempts"><span class="sd-attempts-label">Προσπάθειες:</span> ${parts.join(
        `<span class="sd-attempts-arrow" aria-hidden="true">→</span>`,
    )}</div>`;
}

// ------------------------------------------------ Βαθμοί: τελευταίοι βαθμοί
// Δύο στήλες, οι 5 πιο πρόσφατοι από κάθε πηγή. Ημερομηνία επίσημου:
// το addedAt του eduportal αν ήρθε, αλλιώς η εγγραφή του ιστορικού για την
// ίδια εξεταστική. Ό,τι μένει χωρίς ημερομηνία πάει στο τέλος.
const LATEST_LIMIT = 5;
const SEEN_GRADES_KEY = "halalas_seen_grades";
// Το «Νέο» μετριέται απέναντι σε ό,τι είχε δει αυτή η συσκευή ΠΡΙΝ ανοίξει
// η σελίδα — αλλιώς ένα re-render (φίλτρο, ιστορικό που φόρτωσε μετά) θα
// έσβηνε τις σημάνσεις πριν προλάβεις να τις δεις.
const seenAtLoad = new Map();

function seenStorageKey(userId) {
    return `${SEEN_GRADES_KEY}:${userId ?? ""}`;
}

function seenBefore(userId) {
    if (!seenAtLoad.has(userId)) {
        let stored = null;
        try {
            const parsed = JSON.parse(localStorage.getItem(seenStorageKey(userId)) || "null");
            if (Array.isArray(parsed)) stored = new Set(parsed);
        } catch {
            // χωρίς αποθήκευση: πρώτη επίσκεψη, τίποτα «Νέο»
        }
        seenAtLoad.set(userId, stored);
    }
    return seenAtLoad.get(userId);
}

function rememberSeen(userId, keys) {
    try {
        const previous = JSON.parse(localStorage.getItem(seenStorageKey(userId)) || "[]");
        const union = new Set([...(Array.isArray(previous) ? previous : []), ...keys]);
        localStorage.setItem(seenStorageKey(userId), JSON.stringify([...union]));
    } catch {
        // ιδιωτική περιήγηση κ.λπ. — απλώς δεν θα υπάρχει «Νέο»
    }
}

function officialDate(grade) {
    if (grade.addedAt) return grade.addedAt;
    const attempt = courseAttempts(grade.courseCode).find(
        (a) => (a.examPeriod ?? "") === (grade.examPeriod ?? "") && a.grade === grade.grade,
    );
    return attempt ? attempt.at : null;
}

function byDateDesc(a, b) {
    if (a.at && b.at) return b.at.localeCompare(a.at);
    return a.at ? -1 : b.at ? 1 : 0;
}

function latestOfficial(data) {
    const official = Array.isArray(data.eduportalGrades) ? data.eduportalGrades : [];
    return official
        .filter((g) => typeof g.grade === "number")
        .map((g) => {
            const attempts = courseAttempts(g.courseCode);
            const index = attempts.findIndex((a) => (a.examPeriod ?? "") === (g.examPeriod ?? ""));
            const previous = index > 0 ? attempts[index - 1] : null;
            return {
                seenKey: `o|${g.courseCode}|${g.examPeriod ?? ""}|${g.grade}`,
                cardKey: courseKey(g.courseCode),
                title: g.title || g.courseCode,
                detail: g.examPeriod || "",
                grade: g.grade,
                failed: !g.isPassed,
                previous: previous ? previous.grade : null,
                at: officialDate(g),
            };
        })
        .sort(byDateDesc)
        .slice(0, LATEST_LIMIT);
}

function latestMoodle(data) {
    const courses = Array.isArray(data.courses) ? data.courses : [];
    const items = [];
    for (const course of courses) {
        const title = moodleTitleWithoutCode(course.name) || course.name;
        for (const item of Array.isArray(course.grades) ? course.grades : []) {
            // Χωρίς όνομα είναι σύνολο μαθήματος/κατηγορίας, όχι ξεχωριστός βαθμός.
            if (!item || !item.name || item.grade === null || item.grade === undefined) continue;
            items.push({
                seenKey: `m|${course.name}|${item.name}|${item.grade}`,
                cardKey: courseKey(course.name),
                title,
                detail: item.name,
                grade: item.grade,
                failed: false,
                previous: null,
                at: item.gradedAt || null,
                moodle: true,
            });
        }
    }
    return items.sort(byDateDesc).slice(0, LATEST_LIMIT);
}

function formatGrade(value) {
    const number = Number(value);
    return Number.isFinite(number) ? String(Math.round(number * 100) / 100) : String(value);
}

function latestItemHtml(item, isNew) {
    const date = item.at
        ? new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(item.at))
        : "";
    return `
        <li>
            <button type="button" class="sd-latest-item" data-card="${escapeHtml(item.cardKey)}"${item.moodle ? ` data-moodle="1"` : ""}>
                <span class="sd-latest-main">
                    <span class="sd-latest-course">${escapeHtml(item.title)}${isNew ? ` <span class="sd-latest-new">Νέο</span>` : ""}</span>
                    ${item.detail ? `<span class="sd-latest-detail">${escapeHtml(item.detail)}</span>` : ""}
                    ${date ? `<span class="sd-latest-date">${escapeHtml(date)}</span>` : ""}
                </span>
                <span class="sd-latest-grade-wrap">
                    <span class="sd-latest-grade${item.failed ? " is-failed" : ""}">${escapeHtml(formatGrade(item.grade))}</span>
                    ${item.previous !== null ? `<span class="sd-latest-previous">προηγούμενη: ${escapeHtml(formatGrade(item.previous))}</span>` : ""}
                </span>
            </button>
        </li>`;
}

function renderLatestGrades(data) {
    const frame = document.getElementById("sdLatestGrades");
    const official = latestOfficial(data);
    const moodle = latestMoodle(data);
    frame.hidden = official.length === 0 && moodle.length === 0;
    if (frame.hidden) return;

    const userId = data.user ? data.user.ID : null;
    const seen = seenBefore(userId);
    const fill = (id, items) => {
        document.getElementById(id).innerHTML = items.length
            ? items.map((item) => latestItemHtml(item, Boolean(seen) && !seen.has(item.seenKey))).join("")
            : `<li class="sd-latest-empty">Κανένας βαθμός ακόμα</li>`;
    };
    fill("sdLatestOfficial", official);
    fill("sdLatestMoodle", moodle);

    // Όλοι οι βαθμοί, όχι μόνο οι πέντε: ένας παλιός που δεν φάνηκε ποτέ
    // εδώ δεν πρέπει να εμφανιστεί αργότερα ως «Νέο».
    const allKeys = [
        ...(Array.isArray(data.eduportalGrades) ? data.eduportalGrades : [])
            .filter((g) => typeof g.grade === "number")
            .map((g) => `o|${g.courseCode}|${g.examPeriod ?? ""}|${g.grade}`),
        ...(Array.isArray(data.courses) ? data.courses : []).flatMap((course) =>
            (Array.isArray(course.grades) ? course.grades : [])
                .filter((item) => item && item.name && item.grade !== null && item.grade !== undefined)
                .map((item) => `m|${course.name}|${item.name}|${item.grade}`),
        ),
    ];
    rememberSeen(userId, allKeys);
}

// Από το frame στην κάρτα: αν τα φίλτρα την κρύβουν, καθαρίζονται· αν η
// ενότητά της είναι κλειστή, ανοίγει.
function revealGradeCard(cardKey, expand) {
    const find = () =>
        [...document.querySelectorAll("#sdGradesGrid .sd-course-card")].find((c) => c.dataset.key === cardKey);
    let card = find();
    if (!card && appState.currentData) {
        gradesFilter.status = "all";
        gradesFilter.category = "";
        gradesFilter.query = "";
        gradesSearch.value = "";
        saveGradesFilter();
        renderGrades(appState.currentData);
        card = find();
    }
    if (!card) return;
    const section = card.closest("details");
    if (section) section.open = true;
    if (expand && card.querySelector(".sd-grades-list")) card.classList.add("expanded");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("is-flash");
    void card.offsetWidth;
    card.classList.add("is-flash");
    setTimeout(() => card.classList.remove("is-flash"), 1800);
}

document.getElementById("sdLatestGrades").addEventListener("click", (event) => {
    const item = event.target.closest(".sd-latest-item");
    if (item) revealGradeCard(item.dataset.card, item.dataset.moodle === "1");
});

// ------------------------------------------------- Βαθμοί: φίλτρα, εξάμηνα
// Ομαδοποίηση ανά εξάμηνο του έτους (Χειμερινό / Εαρινό), όπως το γράφει το
// ίδιο το eduportal στο πεδίο `semester`. Τα μαθήματα του Moodle χωρίς
// επίσημη εγγραφή δεν έχουν εξάμηνο και πάνε σε δική τους ενότητα. Αν
// κανένα μάθημα δεν έχει εξάμηνο, πέφτουμε στο «Τρέχοντα / Παλαιότερα».
const gradesSearch = document.getElementById("gradesSearch");
const gradesStatusChips = document.getElementById("gradesStatusChips");
const gradesCategoryFilter = document.getElementById("gradesCategoryFilter");
const GRADES_FILTER_KEY = "halalas_grades_filters";

const gradesFilter = { status: "all", category: "", query: "" };
try {
    const saved = JSON.parse(localStorage.getItem(GRADES_FILTER_KEY) || "{}");
    if (["all", "current", "passed", "owed"].includes(saved.status)) gradesFilter.status = saved.status;
    if (typeof saved.category === "string") gradesFilter.category = saved.category;
} catch {
    // χωρίς αποθηκευμένα φίλτρα, ξεκινάμε από «Όλα»
}

function saveGradesFilter() {
    try {
        localStorage.setItem(
            GRADES_FILTER_KEY,
            JSON.stringify({ status: gradesFilter.status, category: gradesFilter.category }),
        );
    } catch {
        // αγνόησέ το
    }
}

// Ποιες ενότητες άνοιξε ή έκλεισε ο χρήστης σε αυτή την επίσκεψη. Χωρίς
// αυτό κάθε re-render (π.χ. μόλις έρθουν οι εκκρεμότητες) θα τις
// ξανάκλεινε κάτω από τα δάχτυλά του.
const gradeSectionOpen = new Map();

const SEASON_ORDER = ["Χειμερινό", "Εαρινό"];

function semesterOf(entry) {
    const value = entry.official && typeof entry.official.semester === "string" ? entry.official.semester.trim() : "";
    return value || null;
}

function statusOf(entry) {
    return {
        current: Boolean(entry.moodle),
        passed: Boolean(entry.official && entry.official.isPassed),
        owed: Boolean(entry.official && !entry.official.isPassed),
    };
}

function matchesStatus(entry, status) {
    return status === "all" || statusOf(entry)[status];
}

function matchesQuery(entry, query) {
    if (!query) return true;
    const haystack = [
        entry.code,
        entry.official && entry.official.title,
        entry.moodle && entry.moodle.name,
    ]
        .filter(Boolean)
        .join(" ");
    return normalizeForSearch(haystack).includes(query);
}

// Χωρίς τόνους και πεζά, ώστε το «δομες» να βρίσκει «Δομές».
function normalizeForSearch(value) {
    return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// Ο ίδιος υπολογισμός με τη σύνοψη: σταθμισμένος με ECTS όταν υπάρχουν,
// απλός όταν λείπουν, και μόνο από περασμένα με επίσημο βαθμό.
function sectionAverage(entries) {
    const graded = entries
        .map((entry) => entry.official)
        .filter((c) => c && c.isPassed && c.grade !== null && c.grade !== undefined && countsInAverage(c));
    if (graded.length === 0) return null;
    const weights = graded.map((c) => Number(c.ects) || 0);
    const weighted = weights.every((w) => w > 0);
    const total = graded.reduce((sum, c, i) => sum + Number(c.grade) * (weighted ? weights[i] : 1), 0);
    const divisor = weighted ? weights.reduce((a, b) => a + b, 0) : graded.length;
    return total / divisor;
}

function paintGradesFilterControls(all) {
    gradesStatusChips.querySelectorAll(".sd-chip").forEach((chip) => {
        const active = chip.dataset.status === gradesFilter.status;
        chip.classList.toggle("is-active", active);
        chip.setAttribute("aria-pressed", String(active));
        const count = all.filter((entry) => matchesStatus(entry, chip.dataset.status)).length;
        chip.querySelector("span").textContent = String(count);
    });

    const categories = [...new Set(all.map((e) => e.official && e.official.category).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "el"),
    );
    // Μία μόνο κατηγορία = φίλτρο που δεν φιλτράρει τίποτα.
    gradesCategoryFilter.hidden = categories.length < 2;
    if (!categories.includes(gradesFilter.category)) gradesFilter.category = "";
    gradesCategoryFilter.innerHTML =
        `<option value="">Κατηγορία: όλες</option>` +
        categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    gradesCategoryFilter.value = gradesFilter.category;
}

function renderGrades(data) {
    renderLatestGrades(data);
    const grid = document.getElementById("sdGradesGrid");
    grid.innerHTML = "";

    const { current, past } = mergeGradeSources(data);
    const all = [...current, ...past];
    paintGradesFilterControls(all);

    if (all.length === 0) {
        grid.innerHTML = `<div class="sd-no-grades">Δεν βρέθηκαν μαθήματα για τον λογαριασμό σου.</div>`;
        return;
    }

    const query = normalizeForSearch(gradesFilter.query);
    const keep = (entry) =>
        matchesStatus(entry, gradesFilter.status) &&
        (!gradesFilter.category || (entry.official && entry.official.category === gradesFilter.category)) &&
        matchesQuery(entry, query);

    const bySemester = all.some((entry) => semesterOf(entry) !== null);
    let sections;
    if (bySemester) {
        const buckets = new Map();
        for (const entry of all) {
            const semester = semesterOf(entry);
            const key = semester === null ? "none" : `s:${semester}`;
            if (!buckets.has(key)) buckets.set(key, { key, semester, entries: [] });
            buckets.get(key).entries.push(entry);
        }
        // Χειμερινό πριν από Εαρινό, ό,τι άλλο γράψει το eduportal μετά
        // (αλφαβητικά), και τα χωρίς εξάμηνο στο τέλος.
        const rank = (semester) => {
            if (semester === null) return [2, ""];
            const i = SEASON_ORDER.indexOf(semester);
            return i === -1 ? [1, semester] : [0, String(i)];
        };
        sections = [...buckets.values()]
            .sort((a, b) => {
                const [ga, na] = rank(a.semester);
                const [gb, nb] = rank(b.semester);
                return ga - gb || na.localeCompare(nb, "el");
            })
            .map((b) => ({
                key: b.key,
                label: b.semester === null ? "Χωρίς εξάμηνο" : `${b.semester} εξάμηνο`,
                entries: b.entries,
            }));
    } else {
        sections = [
            { key: "current", label: "Τρέχοντα μαθήματα", entries: current },
            { key: "past", label: "Παλαιότερα", entries: past },
        ];
    }

    // Με ενεργό φίλτρο ή αναζήτηση ανοίγουν όλα όσα ταιριάζουν: αν ψάχνεις
    // κάτι, το να είναι κρυμμένο σε κλειστή ενότητα είναι σαν να λείπει.
    const filtering = Boolean(query) || gradesFilter.status !== "all" || Boolean(gradesFilter.category);
    let shown = 0;

    for (const section of sections) {
        // Μέσα σε ένα εξάμηνο τα τρέχοντα πρώτα — είναι αυτά που ψάχνεις —
        // και μετά τα υπόλοιπα, με τη σειρά του κωδικού (η sort είναι σταθερή).
        const visible = section.entries
            .filter(keep)
            .sort((a, b) => (bySemester ? Number(Boolean(b.moodle)) - Number(Boolean(a.moodle)) : 0));
        if (visible.length === 0) continue;
        shown += visible.length;

        const average = sectionAverage(section.entries);
        const ects = section.entries
            .filter((e) => e.official && e.official.isPassed && countsInDiploma(e.official))
            .reduce((sum, e) => sum + (Number(e.official.ects) || 0), 0);
        const hasCurrent = section.entries.some((e) => e.moodle);
        const defaultOpen = !bySemester ? section.key === "current" || !current.length : hasCurrent;
        const open = filtering || (gradeSectionOpen.has(section.key) ? gradeSectionOpen.get(section.key) : defaultOpen);

        const details = document.createElement("details");
        details.className = "sd-grade-section";
        details.open = open;
        const facts = [
            `${visible.length}${visible.length !== section.entries.length ? ` από ${section.entries.length}` : ""} μαθ.`,
            average !== null ? `ΜΟ ${average.toFixed(2)}` : "",
            ects > 0 ? `${ects} ECTS` : "",
        ].filter(Boolean);
        details.innerHTML = `
            <summary class="sd-grade-section-summary">
                <span class="sd-grade-section-title">${escapeHtml(section.label)}</span>
                <span class="sd-grade-section-facts">${facts.map((f) => `<span>${escapeHtml(f)}</span>`).join("")}</span>
                <svg class="sd-chevron" aria-hidden="true"><use href="#i-chevron-down"/></svg>
            </summary>`;
        const row = document.createElement("div");
        row.className = "sd-courses-row";
        visible.forEach((entry) => row.appendChild(buildGradeCard(entry)));
        details.appendChild(row);
        details.addEventListener("toggle", () => {
            if (!filtering) gradeSectionOpen.set(section.key, details.open);
        });
        grid.appendChild(details);
    }

    if (shown === 0) {
        grid.innerHTML = `
            <div class="sd-no-grades">
                Κανένα μάθημα δεν ταιριάζει στα φίλτρα.
                <button type="button" class="sd-history-link" id="gradesResetFilters">Καθαρισμός φίλτρων</button>
            </div>`;
        document.getElementById("gradesResetFilters").addEventListener("click", () => {
            gradesFilter.status = "all";
            gradesFilter.category = "";
            gradesFilter.query = "";
            gradesSearch.value = "";
            saveGradesFilter();
            renderGrades(appState.currentData);
        });
    }
}

gradesSearch.addEventListener("input", () => {
    gradesFilter.query = gradesSearch.value;
    if (appState.currentData) renderGrades(appState.currentData);
});
gradesStatusChips.addEventListener("click", (event) => {
    const chip = event.target.closest(".sd-chip");
    if (!chip) return;
    gradesFilter.status = chip.dataset.status;
    saveGradesFilter();
    if (appState.currentData) renderGrades(appState.currentData);
});
gradesCategoryFilter.addEventListener("change", () => {
    gradesFilter.category = gradesCategoryFilter.value;
    saveGradesFilter();
    if (appState.currentData) renderGrades(appState.currentData);
});

// Από την κάρτα ενός μαθήματος στο ιστορικό του: αλλάζει tab και εφαρμόζει
// το φίλτρο, ώστε να μη χρειάζεται να το ξαναβρείς μόνος σου στη λίστα.
function openHistoryFor(courseCode) {
    selectTab("tabHistory");
    if ([...historyFilter.options].some((option) => option.value === courseCode)) {
        historyFilter.value = courseCode;
    }
    renderHistory();
}

export { DEFAULT_TAB, courseKey, gradeSectionOpen, gradesFilter, gradesSearch, normalizeForSearch, renderGrades, restoreTab, selectTab };
