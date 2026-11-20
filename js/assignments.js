// js/assignments.js — εκκρεμότητες (εργασίες και προθεσμίες).
import { appState } from "./state.js";
import { escapeHtml } from "./util.js";
import { returnToLogin } from "./login.js";
import { courseKey, renderGrades, selectTab } from "./grades.js";

// ----------------------------------------------------------- Εκκρεμότητες
// Δεδομένα από GET /assignments: { ok, available, pendingCount, assignments }
// Κάθε εγγραφή: { id, name, courseId, courseName, moduleName, dueAt,
//                 submitted, overdue, url }
//
// Το `available: false` σημαίνει ότι το Moodle δεν διαβάστηκε — ΔΕΝ είναι το
// ίδιο με «δεν έχεις τίποτα». Αν τα ισοπεδώσουμε, μια αποτυχία θα
// εμφανιζόταν σαν καθαρό ταμπλό, που είναι ο χειρότερος τρόπος να χαλάσει
// αυτή η οθόνη.
const assignmentsBaseUrl = "https://uni-api.halalas-services.xyz/assignments";

const assignmentsBadge = document.getElementById("assignmentsBadge");
const assignmentsNote = document.getElementById("assignmentsNote");
const assignmentsList = document.getElementById("sdAssignmentsList");
const assignmentsRefreshBtn = document.getElementById("assignmentsRefreshBtn");
const assignmentsShowDoneInput = document.getElementById("assignmentsShowDoneInput");

let assignmentEntries = [];
let assignmentsAvailable = false;

const assignmentsCourseFilter = document.getElementById("assignmentsCourseFilter");
const ASSIGNMENTS_VIEW_KEY = "halalas_assignments_view";
let assignmentsView = "due";
try {
    if (localStorage.getItem(ASSIGNMENTS_VIEW_KEY) === "course") assignmentsView = "course";
} catch {
    // αγνόησέ το
}

const DAY_MS = 24 * 60 * 60 * 1000;

function setAssignmentsNote(message, isError = false) {
    assignmentsNote.textContent = message;
    assignmentsNote.hidden = !message;
    assignmentsNote.classList.toggle("is-error", isError);
}

// Πόσο μακριά είναι η προθεσμία, σε λόγια. Οι μέρες μετριούνται σε
// ημερολογιακά μεσάνυχτα και όχι σε 24ωρα, γιατί «αύριο στις 09:00» είναι
// αύριο ακόμα κι όταν απέχει 14 ώρες.
function describeDue(dueAt, now = Date.now()) {
    if (!dueAt) return "χωρίς προθεσμία";

    const due = new Date(dueAt).getTime();
    if (Number.isNaN(due)) return "χωρίς προθεσμία";

    const startOfDay = (value) => {
        const date = new Date(value);
        date.setHours(0, 0, 0, 0);
        return date.getTime();
    };
    const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY_MS);

    if (due < now) {
        if (days === 0) return "έληξε σήμερα";
        if (days === -1) return "έληξε χθες";
        return `έληξε πριν ${Math.abs(days)} μέρες`;
    }
    if (days === 0) return "λήγει σήμερα";
    if (days === 1) return "λήγει αύριο";
    if (days <= 7) return `σε ${days} μέρες`;
    return `σε ${days} μέρες`;
}

function formatDueStamp(dueAt) {
    if (!dueAt) return "";
    const date = new Date(dueAt);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("el-GR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// Οι ομάδες είναι κατά επείγον, όχι κατά μάθημα: η ερώτηση που απαντά αυτή
// η λίστα είναι «τι πρέπει να κάνω τώρα», και η απάντηση δεν εξαρτάται από
// το ποιο μάθημα το ζήτησε.
const ASSIGNMENT_GROUPS = [
    { key: "overdue", label: "Εκπρόθεσμες" },
    { key: "today", label: "Σήμερα και αύριο" },
    { key: "week", label: "Αυτή την εβδομάδα" },
    { key: "later", label: "Αργότερα" },
    { key: "upcoming", label: "Προσεχώς" },
    { key: "undated", label: "Χωρίς προθεσμία" },
    { key: "stale", label: "Πέρασαν πριν καιρό" },
    { key: "done", label: "Παραδομένες" },
];

// Μια προθεσμία που πέρασε χθες είναι επείγουσα. Μια που πέρασε πριν έναν
// μήνα δεν είναι — δεν υπάρχει τίποτα να κάνεις πια, και το να κάθεται
// κόκκινη στην κορυφή κάθε μέρα εκπαιδεύει το μάτι να αγνοεί το κόκκινο.
// Πάνω από αυτό το όριο βγαίνει από τον μετρητή και από τις επείγουσες,
// αλλά δεν σβήνεται: φαίνεται με τον διακόπτη «Δείξε παραδομένα και παλιά».
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

function isStale(assignment, now) {
    if (assignment.submitted || !assignment.dueAt) return false;
    const due = new Date(assignment.dueAt).getTime();
    return !Number.isNaN(due) && now - due > STALE_AFTER_MS;
}

// Ό,τι μετράει σαν πραγματική εκκρεμότητα: αν είναι στον μετρητή, πρέπει
// να μπορείς να κάνεις κάτι γι' αυτό.
function activePending(now = Date.now()) {
    return assignmentEntries.filter((entry) => !entry.submitted && !isStale(entry, now) && !isNotOpenYet(entry, now));
}

// Η υποβολή δεν έχει ανοίξει ακόμα: δεν είναι τελειωμένη, αλλά ούτε
// εκκρεμότητα που μπορείς να πιάσεις σήμερα.
function isNotOpenYet(assignment, now) {
    if (!assignment.notOpenYet || !assignment.dueAt) return false;
    const due = new Date(assignment.dueAt).getTime();
    return !Number.isNaN(due) && due >= now;
}

function groupFor(assignment, now) {
    if (assignment.submitted) return "done";
    if (isNotOpenYet(assignment, now)) return "upcoming";
    if (isStale(assignment, now)) return "stale";
    if (!assignment.dueAt) return "undated";

    const due = new Date(assignment.dueAt).getTime();
    if (Number.isNaN(due)) return "undated";
    if (due < now) return "overdue";
    if (due - now <= 2 * DAY_MS) return "today";
    if (due - now <= 7 * DAY_MS) return "week";
    return "later";
}

function renderAssignmentsBadge() {
    const now = Date.now();
    const pending = activePending(now);
    if (!assignmentsAvailable || pending.length === 0) {
        assignmentsBadge.hidden = true;
        return;
    }

    assignmentsBadge.hidden = false;
    assignmentsBadge.textContent = String(pending.length);
    // Κόκκινο μόνο όταν κάτι έχει όντως λήξει ή λήγει μέσα σε 24 ώρες —
    // αλλιώς το σήμα είναι μονίμως κόκκινο και σταματά να σημαίνει κάτι.
    const urgent = pending.some(
        (entry) => entry.overdue || (entry.dueAt && new Date(entry.dueAt).getTime() - now <= DAY_MS),
    );
    assignmentsBadge.classList.toggle("is-urgent", urgent);
    assignmentsBadge.title = urgent ? "Υπάρχει προθεσμία που λήγει ή έληξε" : "Εκκρεμότητες";
}

function renderAssignments() {
    renderAssignmentsBadge();
    assignmentsList.innerHTML = "";

    if (!assignmentsAvailable) {
        assignmentsList.innerHTML =
            `<div class="sd-no-grades">Δεν μπορέσαμε να διαβάσουμε τις εργασίες από το Moodle. Δοκίμασε «Ανανέωση».</div>`;
        return;
    }

    const now = Date.now();
    paintAssignmentsCourseFilter();
    // Ο ίδιος διακόπτης δείχνει και τα παραδομένα και τα πολύ παλιά: και
    // τα δύο είναι «τελειωμένα, αν τα ψάχνεις είναι εδώ».
    const showAll = assignmentsShowDoneInput.checked;
    const visible = (showAll
        ? assignmentEntries
        : assignmentEntries.filter((entry) => !entry.submitted && !isStale(entry, now))
    ).filter((entry) => !appState.assignmentsCourse || assignmentCourseKey(entry) === appState.assignmentsCourse);

    if (visible.length === 0) {
        assignmentsList.innerHTML = `<div class="sd-no-grades">${
            assignmentEntries.length === 0
                ? "Δεν βρέθηκαν εργασίες με προθεσμία στο Moodle."
                : appState.assignmentsCourse
                  ? "Καμία εκκρεμότητα σε αυτό το μάθημα."
                  : "Καμία εκκρεμότητα — όλα τακτοποιημένα."
        }</div>`;
        return;
    }

    assignmentsList.innerHTML =
        assignmentsView === "course" ? renderAssignmentsByCourse(visible, now) : renderAssignmentsByDue(visible, now);
}

function assignmentItemHtml(entry, groupKey, now) {
    const link = entry.url
        ? `<a class="sd-assignment-link" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">Άνοιγμα στο Moodle<svg class="sd-link-icon" aria-hidden="true"><use href="#i-external-link"/></svg></a>`
        : "";
    const stamp = formatDueStamp(entry.dueAt);
    // Στην προβολή ανά μάθημα το όνομα του μαθήματος είναι ήδη ο τίτλος
    // της ομάδας· δεύτερη φορά σε κάθε γραμμή θα ήταν θόρυβος.
    const course = assignmentsView === "course" ? "" : `<div class="sd-assignment-course">${escapeHtml(entry.courseName)}</div>`;

    return `
        <article class="sd-assignment is-${escapeHtml(groupKey)}">
            <div class="sd-assignment-main">
                <div class="sd-assignment-name">${escapeHtml(entry.name)}</div>
                ${course}
            </div>
            <div class="sd-assignment-due">
                <span class="sd-assignment-relative">${escapeHtml(describeDue(entry.dueAt, now))}</span>
                ${stamp ? `<time datetime="${escapeHtml(entry.dueAt)}">${escapeHtml(stamp)}</time>` : ""}
                ${link}
            </div>
        </article>`;
}

function renderAssignmentsByDue(visible, now) {
    const buckets = new Map(ASSIGNMENT_GROUPS.map((group) => [group.key, []]));
    visible.forEach((entry) => buckets.get(groupFor(entry, now)).push(entry));

    return ASSIGNMENT_GROUPS.filter((group) => buckets.get(group.key).length > 0)
        .map((group) => `
                <div class="sd-assignment-group is-${escapeHtml(group.key)}">
                    <h3 class="sd-assignment-group-title">
                        ${escapeHtml(group.label)}
                        <span class="sd-assignment-group-count">${buckets.get(group.key).length}</span>
                    </h3>
                    ${buckets.get(group.key).map((entry) => assignmentItemHtml(entry, group.key, now)).join("")}
                </div>`)
        .join("");
}

// Ένα μάθημα ανά ομάδα, το πιο πιεστικό πρώτο. «Πιεστικό» με την ίδια
// σειρά που έχουν οι ομάδες της άλλης προβολής (εκπρόθεσμη πριν από
// «σήμερα», «σήμερα» πριν από «αυτή την εβδομάδα»...), και μέσα στην ίδια
// βαθμίδα όποιο λήγει πρώτο.
function renderAssignmentsByCourse(visible, now) {
    const rank = new Map(ASSIGNMENT_GROUPS.map((group, i) => [group.key, i]));
    const dueTime = (entry) => {
        const t = entry.dueAt ? new Date(entry.dueAt).getTime() : NaN;
        return Number.isNaN(t) ? Infinity : t;
    };
    const urgency = (entry) => [rank.get(groupFor(entry, now)), dueTime(entry)];
    const compare = (a, b) => {
        const [ra, ta] = urgency(a);
        const [rb, tb] = urgency(b);
        return ra - rb || ta - tb;
    };

    const courses = new Map();
    for (const entry of visible) {
        const key = assignmentCourseKey(entry);
        if (!courses.has(key)) courses.set(key, { name: entry.courseName, entries: [] });
        courses.get(key).entries.push(entry);
    }
    const groups = [...courses.values()].map((course) => ({ ...course, entries: course.entries.sort(compare) }));
    groups.sort((a, b) => compare(a.entries[0], b.entries[0]));

    return groups
        .map((course) => {
            const first = course.entries[0];
            const firstGroup = groupFor(first, now);
            const pending = course.entries.filter(
                (e) => !e.submitted && !isStale(e, now) && !isNotOpenYet(e, now),
            ).length;
            const next = pending > 0 ? `επόμενη: ${describeDue(first.dueAt, now)}` : "";
            return `
                <div class="sd-assignment-group sd-course-group is-${escapeHtml(firstGroup)}">
                    <h3 class="sd-assignment-group-title sd-course-group-title">
                        <span class="sd-course-group-name">${escapeHtml(course.name)}</span>
                        <span class="sd-assignment-group-count">${course.entries.length}</span>
                        ${next ? `<span class="sd-course-group-next">${escapeHtml(next)}</span>` : ""}
                    </h3>
                    ${course.entries.map((entry) => assignmentItemHtml(entry, groupFor(entry, now), now)).join("")}
                </div>`;
        })
        .join("");
}

// Ίδιο κλειδί με τις κάρτες των βαθμών, ώστε ο σύνδεσμος «2 εκκρεμότητες»
// να καταλήγει στο σωστό φίλτρο.
function assignmentCourseKey(entry) {
    return courseKey(entry.courseName) || String(entry.courseId ?? "");
}

function paintAssignmentsCourseFilter() {
    const courses = new Map();
    for (const entry of assignmentEntries) {
        const key = assignmentCourseKey(entry);
        if (key && !courses.has(key)) courses.set(key, entry.courseName || key);
    }
    if (appState.assignmentsCourse && !courses.has(appState.assignmentsCourse)) appState.assignmentsCourse = "";
    const options = [...courses.entries()].sort((a, b) => a[1].localeCompare(b[1], "el"));
    assignmentsCourseFilter.innerHTML =
        `<option value="">Όλα τα μαθήματα</option>` +
        options.map(([key, name]) => `<option value="${escapeHtml(key)}">${escapeHtml(name)}</option>`).join("");
    assignmentsCourseFilter.value = appState.assignmentsCourse;
    assignmentsCourseFilter.disabled = options.length === 0;

    document.querySelectorAll("#tabAssignments .sd-segment").forEach((button) => {
        const active = button.dataset.view === assignmentsView;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
    });
}

// Από την κάρτα ενός μαθήματος στις εκκρεμότητές του, όπως το
// «Ιστορικό μαθήματος» πηγαίνει στο ιστορικό.
function openAssignmentsFor(key) {
    appState.assignmentsCourse = key;
    selectTab("tabAssignments");
    renderAssignments();
}

function applyAssignmentsPayload(data) {
    assignmentsAvailable = Boolean(data.available);
    assignmentEntries = Array.isArray(data.assignments) ? data.assignments : [];
    renderAssignments();
    // Οι κάρτες των βαθμών δείχνουν πόσες εκκρεμότητες έχει το καθένα,
    // και οι βαθμοί ζωγραφίζονται πριν φτάσουν οι εκκρεμότητες.
    if (appState.currentData) renderGrades(appState.currentData);
}

async function loadAssignments() {
    try {
        const response = await fetch(assignmentsBaseUrl, { credentials: "include" });
        if (response.status === 401) return;

        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error("ASSIGNMENTS_FAILED");

        applyAssignmentsPayload(data);
        setAssignmentsNote("");
    } catch (error) {
        // Κρατάμε ό,τι δείχναμε· ένα δίκτυο που κόπηκε δεν είναι λόγος να
        // σβήσουμε προθεσμίες από την οθόνη.
        setAssignmentsNote("Δεν φορτώθηκαν οι εκκρεμότητες.", true);
    }
}

async function refreshAssignments() {
    assignmentsRefreshBtn.disabled = true;
    setAssignmentsNote("Ανανέωση...");

    try {
        const response = await fetch(`${assignmentsBaseUrl}/refresh`, {
            method: "POST",
            credentials: "include",
        });
        const data = await response.json();

        if (response.status === 401) {
            returnToLogin("Η σύνδεση έληξε. Συνδέσου ξανά.");
            return;
        }
        // Το session επέζησε restart του server αλλά το Moodle token όχι —
        // η αποθηκευμένη λίστα παίζει κανονικά, μόνο η ανανέωση θέλει login.
        if (response.status === 409) {
            setAssignmentsNote("Χρειάζεται νέο login για ανανέωση. Η λίστα που βλέπεις είναι από την τελευταία σύνδεση.", true);
            return;
        }
        if (!response.ok || !data.ok) throw new Error("REFRESH_FAILED");

        applyAssignmentsPayload(data);
        setAssignmentsNote("Ενημερώθηκε.");
    } catch (error) {
        setAssignmentsNote("Η ανανέωση απέτυχε. Δοκίμασε ξανά.", true);
    } finally {
        assignmentsRefreshBtn.disabled = false;
    }
}

assignmentsRefreshBtn.addEventListener("click", refreshAssignments);
assignmentsShowDoneInput.addEventListener("change", renderAssignments);
assignmentsCourseFilter.addEventListener("change", () => {
    appState.assignmentsCourse = assignmentsCourseFilter.value;
    renderAssignments();
});
document.querySelectorAll("#tabAssignments .sd-segment").forEach((button) => {
    button.addEventListener("click", () => {
        assignmentsView = button.dataset.view;
        try {
            localStorage.setItem(ASSIGNMENTS_VIEW_KEY, assignmentsView);
        } catch {
            // αγνόησέ το
        }
        renderAssignments();
    });
});

export { activePending, applyAssignmentsPayload, isStale, loadAssignments, openAssignmentsFor };
