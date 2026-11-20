// js/files.js — τα αρχεία των μαθημάτων από το eLearn.
import { appState } from "./state.js";
import { escapeHtml } from "./util.js";
import { returnToLogin, signOut } from "./login.js";
import { normalizeForSearch } from "./grades.js";

// ---------------------------------------------------------------- Αρχεία
// Δεδομένα από GET /auth/files: { ok, courses: [{courseId, name, isPast}],
//   files: [...], partial: ["course:<id>"|"assignments"|"submissions"], fetchedAt }
// Κάθε αρχείο: { id, courseId, section, sectionOrder, name, kind, mimetype,
//   size, addedAt, source: "course"|"assignment"|"submission", assignmentName? }
//
// Το πραγματικό URL του Moodle δεν έρχεται ποτέ εδώ (κουβαλάει το token).
// Για να ανοίξει ένα αρχείο ζητάμε από τον server ένα εισιτήριο λίγων λεπτών
// και ανοίγουμε αυτό.
const filesBaseUrl = "https://uni-api.halalas-services.xyz/auth/files";
// Τα view/download του εισιτηρίου είναι root-relative, πάνω στο API.
const filesApiOrigin = new URL(filesBaseUrl).origin;
const FILES_VIEW_KEY = "halalas_files_view";
const SEEN_FILES_KEY = "halalas_seen_files";
const FILE_KIND_LABELS = { pdf: "PDF", word: "Word", powerpoint: "PowerPoint", other: "Λοιπά" };
const ASSIGNMENTS_SECTION = "Εργασίες";

const filesList = document.getElementById("sdFilesList");
const filesNote = document.getElementById("filesNote");
const filesSearch = document.getElementById("filesSearch");
const filesKindChips = document.getElementById("filesKindChips");

// "idle": δεν ζητήθηκε ακόμα · "loading" · "ready" · "relogin" · "error"
let filesState = "idle";
let filesData = null;
// Κάθε φόρτωμα παίρνει αριθμό· μια απάντηση που έρχεται αφού έγινε logout
// ή αφού ξεκίνησε νεότερο φόρτωμα πετιέται αντί να ζωγραφίσει πάνω του.
let filesLoadId = 0;
// Τύπος και αναζήτηση δεν αποθηκεύονται, όπως και το φίλτρο μαθήματος των
// εκκρεμοτήτων: αν τα βρεις ενεργά αύριο θα νομίζεις ότι λείπουν αρχεία.
const filesFilter = { kind: "", query: "" };
let filesView = "course";
try {
    if (localStorage.getItem(FILES_VIEW_KEY) === "recent") filesView = "recent";
} catch {
    // αγνόησέ το
}
// Ό,τι άνοιξε ή έκλεισε ο χρήστης σε αυτή την επίσκεψη, όπως στους Βαθμούς.
const filesCourseOpen = new Map();

function filesLoaded() {
    return filesState !== "idle";
}

function ensureFilesLoaded() {
    if (filesState === "idle") loadFiles();
}

function resetFiles() {
    filesLoadId++;
    filesState = "idle";
    filesData = null;
    filesFilter.kind = "";
    filesFilter.query = "";
    filesSearch.value = "";
    filesCourseOpen.clear();
    filesList.innerHTML = "";
    setFilesNote("");
}

function setFilesNote(message, isError = false) {
    filesNote.textContent = message;
    filesNote.hidden = !message;
    filesNote.classList.toggle("is-error", isError);
}

async function loadFiles({ refresh = false } = {}) {
    const loadId = ++filesLoadId;
    // Στην ανανέωση μένει η παλιά λίστα στην οθόνη μέχρι να έρθει η νέα·
    // το να αδειάζει για ένα δευτερόλεπτο δεν λέει τίποτα χρήσιμο.
    if (!filesData) {
        filesState = "loading";
        filesList.innerHTML = `<div class="sd-no-grades">Φόρτωση αρχείων…</div>`;
    }
    try {
        const response = await fetch(refresh ? `${filesBaseUrl}?refresh=1` : filesBaseUrl, { credentials: "include" });
        if (loadId !== filesLoadId) return;
        if (response.status === 401) {
            returnToLogin("Η σύνδεση έληξε. Συνδέσου ξανά.");
            return;
        }
        const data = await response.json().catch(() => ({}));
        if (loadId !== filesLoadId) return;
        if (response.status === 409 && data.code === "NEEDS_RELOGIN") {
            filesState = "relogin";
            filesData = null;
            renderFiles();
            return;
        }
        if (!response.ok || !data.ok) throw new Error(data.code || "FILES_FAILED");

        filesData = {
            courses: Array.isArray(data.courses) ? data.courses : [],
            files: Array.isArray(data.files) ? data.files : [],
            partial: Array.isArray(data.partial) ? data.partial : [],
        };
        filesState = "ready";
        setFilesNote("");
        renderFiles();
        rememberSeenFiles(appState.currentData && appState.currentData.user ? appState.currentData.user.ID : null, filesData);
    } catch (error) {
        if (loadId !== filesLoadId) return;
        // Με λίστα ήδη στην οθόνη (αποτυχημένη ανανέωση) την κρατάμε και
        // το λέμε· χωρίς λίστα δείχνουμε το σφάλμα στη θέση της.
        const message =
            error.message === "MOODLE_UNAVAILABLE"
                ? "Το elearn δεν απαντάει αυτή τη στιγμή."
                : "Δεν φορτώθηκαν τα αρχεία.";
        if (filesData) {
            setFilesNote(`${message} Βλέπεις την προηγούμενη λίστα.`, true);
        } else {
            filesState = "error";
            filesList.innerHTML = `
                <div class="sd-no-grades">
                    ${escapeHtml(message)}
                    <button type="button" class="sd-history-link" data-files-action="retry">Δοκίμασε ξανά</button>
                </div>`;
        }
    }
}

// ------------------------------------------------------ Αρχεία: «Νέο»
// Όπως στους βαθμούς: σύγκριση με ό,τι είχε δει αυτή η συσκευή ΠΡΙΝ ανοίξει
// η σελίδα, ώστε ένα re-render ή μια ανανέωση να μη σβήνει τα σήματα πριν
// τα δεις. Εδώ η αποθήκευση είναι ανά μάθημα: { [courseId]: [fileId, …] }.
// Ένα μάθημα που δεν υπάρχει εκεί (νέα εγγραφή, ή δεν φόρτωσε την
// προηγούμενη φορά) μπαίνει ως baseline, αλλιώς θα ερχόταν με όλα του τα
// αρχεία «Νέα» και το σήμα δεν θα σήμαινε τίποτα.
const seenFilesAtLoad = new Map();

function seenFilesStorageKey(userId) {
    return `${SEEN_FILES_KEY}:${userId ?? ""}`;
}

function readSeenFiles(userId) {
    try {
        const parsed = JSON.parse(localStorage.getItem(seenFilesStorageKey(userId)) || "null");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function seenFilesBefore(userId) {
    if (!seenFilesAtLoad.has(userId)) {
        const stored = readSeenFiles(userId);
        const snapshot = new Map();
        if (stored) {
            for (const [courseId, ids] of Object.entries(stored)) {
                if (Array.isArray(ids)) snapshot.set(courseId, new Set(ids));
            }
        }
        seenFilesAtLoad.set(userId, snapshot);
    }
    return seenFilesAtLoad.get(userId);
}

function isNewFile(file) {
    // Ό,τι ανέβασες εσύ δεν είναι νέο για σένα.
    if (file.source === "submission") return false;
    const userId = appState.currentData && appState.currentData.user ? appState.currentData.user.ID : null;
    const seen = seenFilesBefore(userId).get(String(file.courseId));
    return Boolean(seen) && !seen.has(file.id);
}

function rememberSeenFiles(userId, data) {
    seenFilesBefore(userId); // το snapshot πρώτα, πριν γράψουμε από πάνω
    const failed = new Set(data.partial);
    const stored = readSeenFiles(userId) || {};
    for (const course of data.courses) {
        const courseId = String(course.courseId);
        // Μάθημα που δεν φόρτωσε δεν καταγράφεται: θα γινόταν baseline με
        // μηδέν αρχεία και την επόμενη φορά όλα του θα έβγαιναν «Νέα».
        if (failed.has(`course:${courseId}`)) continue;
        const ids = data.files
            .filter((file) => String(file.courseId) === courseId && file.source !== "submission")
            .map((file) => file.id);
        const previous = Array.isArray(stored[courseId]) ? stored[courseId] : [];
        stored[courseId] = [...new Set([...previous, ...ids])];
    }
    try {
        localStorage.setItem(seenFilesStorageKey(userId), JSON.stringify(stored));
    } catch {
        // ιδιωτική περιήγηση κ.λπ. — απλώς δεν θα υπάρχει «Νέο»
    }
}

// ------------------------------------------------------ Αρχεία: εμφάνιση
function fileTime(file) {
    const t = file.addedAt ? new Date(file.addedAt).getTime() : NaN;
    return Number.isNaN(t) ? null : t;
}

function formatFileDate(file) {
    const t = fileTime(file);
    return t === null
        ? ""
        : new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(t));
}

function formatFileSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toLocaleString("el-GR", { maximumFractionDigits: 1 })} MB`;
}

function fileKind(file) {
    return FILE_KIND_LABELS[file.kind] ? file.kind : "other";
}

function filesCourseMap() {
    const map = new Map();
    for (const course of filesData.courses) map.set(String(course.courseId), course);
    // Αρχείο από μάθημα που λείπει από τη λίστα μαθημάτων δεν πρέπει να
    // χαθεί σιωπηλά· μπαίνει σε δικό του, ως τρέχον.
    for (const file of filesData.files) {
        const id = String(file.courseId);
        if (!map.has(id)) map.set(id, { courseId: file.courseId, name: `Μάθημα ${id}`, isPast: false });
    }
    return map;
}

function fileMatches(file, query, courseName) {
    if (filesFilter.kind && fileKind(file) !== filesFilter.kind) return false;
    if (!query) return true;
    const haystack = [file.name, file.section, courseName, file.assignmentName].filter(Boolean).join(" ");
    return normalizeForSearch(haystack).includes(query);
}

function fileRowHtml(file, { courseName = "" } = {}) {
    const mine = file.source === "submission";
    const meta = [courseName, formatFileDate(file), courseName ? "" : formatFileSize(file.size)].filter(Boolean);
    const kind = fileKind(file);
    return `
        <li class="sd-file-row">
            <button type="button" class="sd-file-open" data-file-id="${escapeHtml(file.id)}">
                <svg class="sd-file-icon is-${kind}" aria-hidden="true"><use href="#i-file"/></svg>
                <span class="sd-file-main">
                    <span class="sd-file-name">${escapeHtml(file.name)}${
                        isNewFile(file) ? ` <span class="sd-file-new">Νέο</span>` : ""
                    }${mine ? ` <span class="sd-file-mine">Δικό μου</span>` : ""}</span>
                    ${meta.length ? `<span class="sd-file-meta">${meta.map(escapeHtml).join(" · ")}</span>` : ""}
                </span>
            </button>
            <button type="button" class="sd-file-download" data-file-id="${escapeHtml(file.id)}"
                    aria-label="Λήψη ${escapeHtml(file.name)}" title="Λήψη">
                <svg aria-hidden="true"><use href="#i-download"/></svg>
            </button>
        </li>`;
}

// Μέσα σε ένα μάθημα: ενότητες με τη σειρά του Moodle. Εκφωνήσεις και δικές
// μου υποβολές μπαίνουν σε μία ενότητα «Εργασίες», ανά εργασία, με την
// εκφώνηση πρώτα και από κάτω ό,τι παρέδωσα — η λύση δίπλα στην άσκηση.
function courseFilesHtml(files) {
    const sections = new Map();
    const assignments = new Map();
    for (const file of files) {
        if (file.source === "assignment" || file.source === "submission") {
            const key = file.assignmentName || "";
            if (!assignments.has(key)) assignments.set(key, { brief: [], mine: [] });
            assignments.get(key)[file.source === "submission" ? "mine" : "brief"].push(file);
            continue;
        }
        const key = file.section || "";
        if (!sections.has(key)) sections.set(key, { name: key, order: Number(file.sectionOrder) || 0, files: [] });
        sections.get(key).files.push(file);
    }
    // Η sort είναι σταθερή: μέσα στην ίδια ενότητα μένει η σειρά του server.
    const ordered = [...sections.values()].sort((a, b) => a.order - b.order);
    const sectionHtml = (title, body) => `
        <div class="sd-files-section">
            <h4 class="sd-files-section-title">${escapeHtml(title || "Γενικά")}</h4>
            ${body}
        </div>`;
    const parts = ordered.map((s) => sectionHtml(s.name, `<ul class="sd-files-rows">${s.files.map((f) => fileRowHtml(f)).join("")}</ul>`));
    if (assignments.size > 0) {
        parts.push(sectionHtml(
            ASSIGNMENTS_SECTION,
            [...assignments.entries()]
                .map(([name, group]) => `
                    <div class="sd-files-assignment">
                        ${name ? `<div class="sd-files-assignment-name">${escapeHtml(name)}</div>` : ""}
                        <ul class="sd-files-rows">${[...group.brief, ...group.mine].map((f) => fileRowHtml(f)).join("")}</ul>
                    </div>`)
                .join(""),
        ));
    }
    return parts.join("");
}

function renderFilesByCourse(visible, courses, filtering) {
    const byCourse = new Map();
    for (const file of visible) {
        const id = String(file.courseId);
        if (!byCourse.has(id)) byCourse.set(id, []);
        byCourse.get(id).push(file);
    }
    const totals = new Map();
    for (const file of filesData.files) totals.set(String(file.courseId), (totals.get(String(file.courseId)) || 0) + 1);

    const courseHtml = (course) => {
        const id = String(course.courseId);
        const files = byCourse.get(id);
        const total = totals.get(id) || 0;
        // Με φίλτρο ανοίγουν όλα όσα ταιριάζουν, όπως στους Βαθμούς.
        const open = filtering || (filesCourseOpen.has(id) ? filesCourseOpen.get(id) : !course.isPast);
        const count = `${files.length}${files.length !== total ? ` από ${total}` : ""} αρχ.`;
        return `
            <details class="sd-grade-section sd-files-course" data-course-id="${escapeHtml(id)}"${open ? " open" : ""}>
                <summary class="sd-grade-section-summary">
                    <span class="sd-grade-section-title">${escapeHtml(course.name)}</span>
                    <span class="sd-grade-section-facts"><span>${escapeHtml(count)}</span></span>
                    <svg class="sd-chevron" aria-hidden="true"><use href="#i-chevron-down"/></svg>
                </summary>
                <div class="sd-files-course-body">${courseFilesHtml(files)}</div>
            </details>`;
    };

    // Η σειρά των μαθημάτων είναι αυτή που στέλνει ο server.
    const withFiles = [...courses.values()].filter((c) => byCourse.has(String(c.courseId)));
    const current = withFiles.filter((c) => !c.isPast);
    const past = withFiles.filter((c) => c.isPast);
    return (
        current.map(courseHtml).join("") +
        (past.length ? `<h3 class="sd-files-group-title">Παλαιότερα</h3>${past.map(courseHtml).join("")}` : "")
    );
}

// Όλα μαζί, το πιο πρόσφατο πρώτο· όσα δεν έχουν ημερομηνία στο τέλος.
function renderFilesRecent(visible, courses) {
    const sorted = [...visible].sort((a, b) => {
        const ta = fileTime(a);
        const tb = fileTime(b);
        if (ta !== null && tb !== null) return tb - ta;
        return ta !== null ? -1 : tb !== null ? 1 : 0;
    });
    return `<ul class="sd-files-rows sd-files-recent">${sorted
        .map((file) => fileRowHtml(file, { courseName: courses.get(String(file.courseId)).name }))
        .join("")}</ul>`;
}

function paintFilesControls() {
    document.querySelectorAll("#tabFiles .sd-segment").forEach((button) => {
        const active = button.dataset.view === filesView;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
    });
    const files = filesData ? filesData.files : [];
    filesKindChips.querySelectorAll(".sd-chip").forEach((chip) => {
        const active = chip.dataset.kind === filesFilter.kind;
        chip.classList.toggle("is-active", active);
        chip.setAttribute("aria-pressed", String(active));
        chip.querySelector("span").textContent = String(files.filter((f) => fileKind(f) === chip.dataset.kind).length);
    });
}

function renderFiles() {
    paintFilesControls();
    if (filesState === "relogin") {
        // Το session ζει, αλλά δεν υπάρχει Moodle token για να διαβάσουμε
        // αρχεία (π.χ. session από πριν προστεθούν τα αρχεία). Ένα νέο login
        // το φτιάχνει· ο υπόλοιπος πίνακας δουλεύει κανονικά ως τότε.
        filesList.innerHTML = `
            <div class="sd-no-grades">
                Για τα αρχεία χρειάζεται να συνδεθείς ξανά μία φορά.
                <button type="button" class="sd-history-link" id="filesReloginBtn" data-files-action="relogin">Σύνδεση ξανά</button>
            </div>`;
        return;
    }
    if (filesState !== "ready" || !filesData) return;

    // Το partial σημαίνει ότι η λίστα ΔΕΝ είναι πλήρης. Αν δεν το πούμε,
    // ένα μάθημα που δεν φόρτωσε μοιάζει με μάθημα χωρίς αρχεία.
    const courses = filesCourseMap();
    const failedNames = filesData.partial.map((item) => {
        if (item.startsWith("course:")) {
            const course = courses.get(item.slice(7));
            return course ? course.name : null;
        }
        return item === "assignments" ? "εκφωνήσεις εργασιών" : item === "submissions" ? "οι υποβολές σου" : null;
    }).filter(Boolean);
    const warning = filesData.partial.length
        ? `<p class="sd-history-note is-error sd-files-partial">Κάποια αρχεία δεν φορτώθηκαν${
              failedNames.length ? ` (${escapeHtml(failedNames.join(", "))})` : ""
          }. Δοκίμασε «Ανανέωση» σε λίγο.</p>`
        : "";

    if (filesData.files.length === 0) {
        filesList.innerHTML = `${warning}<div class="sd-no-grades">Δεν βρέθηκαν αρχεία στα μαθήματά σου.</div>`;
        return;
    }

    const query = normalizeForSearch(filesFilter.query);
    const filtering = Boolean(query) || Boolean(filesFilter.kind);
    const visible = filesData.files.filter((file) => {
        const course = courses.get(String(file.courseId));
        return fileMatches(file, query, course ? course.name : "");
    });
    if (visible.length === 0) {
        filesList.innerHTML = `${warning}
            <div class="sd-no-grades">
                Κανένα αρχείο δεν ταιριάζει στα φίλτρα.
                <button type="button" class="sd-history-link" data-files-action="reset">Καθαρισμός φίλτρων</button>
            </div>`;
        return;
    }
    filesList.innerHTML =
        warning + (filesView === "recent" ? renderFilesRecent(visible, courses) : renderFilesByCourse(visible, courses, filtering));
    filesList.querySelectorAll("details[data-course-id]").forEach((details) => {
        details.addEventListener("toggle", () => {
            if (!filtering) filesCourseOpen.set(details.dataset.courseId, details.open);
        });
    });
}

// ------------------------------------------------------ Αρχεία: άνοιγμα
// Το iOS (και ειδικά η εφαρμογή στην αρχική οθόνη) ανοίγει νέο παράθυρο
// μόνο μέσα στο ίδιο το πάτημα. Μετά από ένα await το «πάτημα» έχει λήξει
// και το window.open μπλοκάρεται. Γι' αυτό ανοίγουμε άδειο παράθυρο ΑΜΕΣΩΣ
// και του δίνουμε διεύθυνση όταν έρθει το εισιτήριο.
//
// Το εισιτήριο δεν θέλει cookie: η εφαρμογή της αρχικής οθόνης έχει άλλα
// cookies από το Safari που θα ανοίξει το αρχείο, οπότε ένα link που
// βασιζόταν στη session θα αποτύγχανε ακριβώς εκεί που ζει ο χρήστης.
async function openFile(fileId, mode) {
    const w = window.open("", "_blank");
    setFilesNote("");
    try {
        const response = await fetch(`${filesBaseUrl}/${encodeURIComponent(fileId)}/link`, {
            method: "POST",
            credentials: "include",
        });
        if (response.status === 401) {
            if (w) w.close();
            returnToLogin("Η σύνδεση έληξε. Συνδέσου ξανά.");
            return;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.code || "LINK_FAILED");
        const path = mode === "download" ? data.download : data.view;
        // Μόνο root-relative διαδρομή πάνω στο δικό μας API· οτιδήποτε άλλο
        // δεν είναι αυτό που υπόσχεται ο server και δεν το ανοίγουμε.
        if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) throw new Error("LINK_FAILED");
        const url = filesApiOrigin + path;
        if (w) w.location = url;
        else location.href = url;
    } catch (error) {
        if (w) w.close();
        if (error.message === "NEEDS_RELOGIN") {
            filesState = "relogin";
            filesData = null;
            renderFiles();
            return;
        }
        setFilesNote(
            error.message === "FILE_NOT_FOUND"
                ? "Το αρχείο δεν βρέθηκε πια στο elearn. Δοκίμασε «Ανανέωση»."
                : error.message === "MOODLE_UNAVAILABLE"
                  ? "Το elearn δεν απαντάει αυτή τη στιγμή. Δοκίμασε ξανά σε λίγο."
                  : "Το αρχείο δεν άνοιξε. Δοκίμασε ξανά.",
            true,
        );
    }
}

filesList.addEventListener("click", (event) => {
    const download = event.target.closest(".sd-file-download");
    const open = event.target.closest(".sd-file-open");
    if (download || open) {
        openFile((download || open).dataset.fileId, download ? "download" : "view");
        return;
    }
    const action = event.target.closest("[data-files-action]");
    if (!action) return;
    if (action.dataset.filesAction === "retry") loadFiles();
    else if (action.dataset.filesAction === "relogin") signOut();
    else if (action.dataset.filesAction === "reset") {
        filesFilter.kind = "";
        filesFilter.query = "";
        filesSearch.value = "";
        renderFiles();
    }
});
filesSearch.addEventListener("input", () => {
    filesFilter.query = filesSearch.value;
    renderFiles();
});
filesKindChips.addEventListener("click", (event) => {
    const chip = event.target.closest(".sd-chip");
    if (!chip) return;
    filesFilter.kind = filesFilter.kind === chip.dataset.kind ? "" : chip.dataset.kind;
    renderFiles();
});
document.querySelectorAll("#tabFiles .sd-segment").forEach((button) => {
    button.addEventListener("click", () => {
        filesView = button.dataset.view;
        try {
            localStorage.setItem(FILES_VIEW_KEY, filesView);
        } catch {
            // αγνόησέ το
        }
        renderFiles();
    });
});
paintFilesControls();

export { ensureFilesLoaded, filesLoaded, loadFiles, resetFiles };
