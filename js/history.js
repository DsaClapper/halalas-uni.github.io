// js/history.js — ιστορικό επίσημων βαθμών.
import { appState } from "./state.js";
import { escapeHtml } from "./util.js";
import { openAppModal } from "./modal.js";
import { renderGrades } from "./grades.js";

// ---------------------------------------------------------------- Ιστορικό
// Δεδομένα από GET /history/eduportal: { ok, enabled, total, history: [...] }
// με νεότερη εγγραφή πρώτη. Κάθε εγγραφή:
//   { at, approximateDate, source: "live"|"examPeriod",
//     type: "baseline"|"new"|"changed", from?, courseCode, title,
//     semester, examPeriod, grade, isPassed, modifiedAt?, observedAt? }
const historyBaseUrl = "https://uni-api.halalas-services.xyz/history";
const historyToggleInput = document.getElementById("historyToggleInput");
const historyBackfillBtn = document.getElementById("historyBackfillBtn");
const historyFilter = document.getElementById("historyFilter");
const historyNote = document.getElementById("historyNote");
const historyTimeline = document.getElementById("sdHistoryTimeline");

// A result is identified by (course, exam period): sitting a course again is
// a new attempt even when the mark is identical, and only a revision inside
// the *same* period is the registry correcting itself.
const HISTORY_TYPE_LABELS = {
    baseline: "Αρχική καταγραφή",
    new: "Νέος βαθμός",
    retake: "Επανεξέταση",
    corrected: "Διόρθωση",
    changed: "Αλλαγή βαθμού", // ιστορικές εγγραφές πριν τον διαχωρισμό
};

function setHistoryNote(message, isError = false) {
    historyNote.textContent = message;
    historyNote.hidden = !message;
    historyNote.classList.toggle("is-error", isError);
}

// Οι backdated εγγραφές ξέρουν μόνο μήνα/χρονιά — μη δείχνεις ώρα που δεν
// την ξέρουμε.
function formatHistoryDate(entry) {
    const date = new Date(entry.at);
    if (Number.isNaN(date.getTime())) return "—";

    if (entry.approximateDate) {
        return `~ ${new Intl.DateTimeFormat("el-GR", {
            month: "long",
            year: "numeric",
        }).format(date)}`;
    }
    return new Intl.DateTimeFormat("el-GR", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(date);
}

function renderHistoryFilterOptions() {
    const selected = historyFilter.value;
    const courses = new Map();
    appState.historyEntries.forEach((entry) => {
        if (entry.courseCode && !courses.has(entry.courseCode)) {
            courses.set(entry.courseCode, entry.title || entry.courseCode);
        }
    });

    const sorted = [...courses.entries()].sort((first, second) =>
        first[0].localeCompare(second[0], undefined, { numeric: true, sensitivity: "base" }),
    );

    historyFilter.innerHTML =
        `<option value="">Όλα τα μαθήματα</option>` +
        sorted
            .map(([code, title]) =>
                `<option value="${escapeHtml(code)}">${escapeHtml(code)} — ${escapeHtml(title)}</option>`)
            .join("");
    historyFilter.value = courses.has(selected) ? selected : "";
    historyFilter.disabled = sorted.length === 0;
}

function renderHistory() {
    historyTimeline.innerHTML = "";
    historyBackfillBtn.hidden = !appState.historyEnabled;
    historyFilter.hidden = !appState.historyEnabled;

    if (!appState.historyEnabled) {
        historyTimeline.innerHTML =
            // Ένα άδειο πάνελ που λέει μόνο "είναι κλειστό" δεν δίνει
            // κανέναν λόγο να το ανοίξεις. Το eduportal δείχνει πάντα
            // μόνο την τρέχουσα κατάσταση — αυτό που χάνεται χωρίς
            // καταγραφή είναι το πότε άλλαξε κάτι, και δεν ξαναβρίσκεται.
            `<div class="sd-empty-pitch">
                <p class="sd-empty-title">Η καταγραφή ιστορικού είναι κλειστή</p>
                <p>Το eduportal δείχνει μόνο τον βαθμό που ισχύει τώρα. Με την καταγραφή ανοιχτή
                   κρατάμε <strong>πότε</strong> βγήκε κάθε βαθμός, τι έδειχνε πριν αν διορθώθηκε,
                   και ποια εξεταστική ήταν η κάθε προσπάθεια.</p>
                <p class="sd-empty-note">Όσο είναι κλειστή δεν καταγράφεται τίποτα — οι αλλαγές που
                   γίνονται στο μεταξύ χάνονται οριστικά.</p>
            </div>`;
        return;
    }

    const courseCode = historyFilter.value;
    const visible = courseCode
        ? appState.historyEntries.filter((entry) => entry.courseCode === courseCode)
        : appState.historyEntries;

    if (visible.length === 0) {
        historyTimeline.innerHTML = `<div class="sd-no-grades">${
            courseCode
                ? "Δεν υπάρχουν εγγραφές για αυτό το μάθημα."
                : "Δεν υπάρχουν εγγραφές ακόμα. Δοκιμάστε «Εισαγωγή παλαιότερων» για να φέρετε όλες τις εξεταστικές."
        }</div>`;
        return;
    }

    historyTimeline.innerHTML = visible
        .map((entry) => {
            const typeLabel = HISTORY_TYPE_LABELS[entry.type] || entry.type;
            const hasPrevious = entry.from !== null && entry.from !== undefined;
            // Only a correction genuinely replaces an earlier mark, so only
            // it gets the struck-through "was". A re-sit stands on its own
            // and carries the previous sitting as a footnote instead.
            const gradeText =
                hasPrevious && (entry.type === "corrected" || entry.type === "changed")
                    ? `<span class="sd-history-from">${escapeHtml(entry.from)}</span>
                       <svg class="sd-history-arrow" aria-hidden="true"><use href="#i-arrow-right"/></svg>
                       <span class="sd-history-grade">${escapeHtml(entry.grade)}</span>`
                    : `<span class="sd-history-grade">${escapeHtml(entry.grade)}</span>`;

            const previousNote =
                entry.type === "retake" && hasPrevious
                    ? `<div class="sd-history-previous">Προηγούμενη προσπάθεια: ${escapeHtml(entry.from)}${
                          entry.fromExamPeriod ? ` (${escapeHtml(entry.fromExamPeriod)})` : ""
                      }</div>`
                    : "";

            const meta = [
                entry.examPeriod ? `Εξεταστική: ${entry.examPeriod}` : "",
                entry.semester ? `Εξάμηνο: ${entry.semester}` : "",
                entry.source === "examPeriod" ? "από εξεταστική" : "",
            ].filter(Boolean);

            return `
                <article class="sd-history-entry is-${escapeHtml(entry.type)}">
                    <div class="sd-history-when">
                        <time datetime="${escapeHtml(entry.at)}">${escapeHtml(formatHistoryDate(entry))}</time>
                        <span class="sd-history-badge">${escapeHtml(typeLabel)}</span>
                    </div>
                    <div class="sd-history-body">
                        <div class="sd-history-course">
                            ${escapeHtml(entry.title || entry.courseCode)}
                            <span class="sd-course-code">(${escapeHtml(entry.courseCode)})</span>
                        </div>
                        <div class="sd-history-grades ${entry.isPassed ? "is-passed" : "is-failed"}">
                            ${gradeText}
                        </div>
                        ${previousNote}
                        ${meta.length
                            ? `<div class="sd-course-meta">${meta
                                  .map((item) => `<span>${escapeHtml(item)}</span>`)
                                  .join("")}</div>`
                            : ""}
                    </div>
                </article>`;
        })
        .join("");
}

async function loadHistory() {
    try {
        const response = await fetch(`${historyBaseUrl}/eduportal?limit=200`, {
            credentials: "include",
        });
        if (response.status === 401) return;

        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error("HISTORY_FAILED");

        appState.historyEnabled = data.enabled === true;
        appState.historyEntries = Array.isArray(data.history) ? data.history : [];
        historyToggleInput.checked = appState.historyEnabled;
        renderHistoryFilterOptions();
        renderHistory();
        if (appState.currentData) renderGrades(appState.currentData);
        setHistoryNote("");
    } catch {
        setHistoryNote("Δεν ήταν δυνατή η φόρτωση του ιστορικού.", true);
    }
}

async function setHistoryEnabled(enabled) {
    if (!enabled) {
        const confirmed = await openAppModal({
            title: "Απενεργοποίηση ιστορικού",
            message: "Η καταγραφή σταματά και οι εγγραφές που έχουν κρατηθεί διαγράφονται. Θέλετε να συνεχίσετε;",
            confirmLabel: "Απενεργοποίηση",
        });
        if (!confirmed) {
            historyToggleInput.checked = true;
            return;
        }
    }

    historyToggleInput.disabled = true;
    try {
        const response = await fetch(`${historyBaseUrl}/${enabled ? "enable" : "disable"}`, {
            credentials: "include",
            method: "POST",
        });
        if (!response.ok) throw new Error("TOGGLE_FAILED");
        await loadHistory();
        setHistoryNote(
            enabled
                ? "Η καταγραφή ενεργοποιήθηκε. Από εδώ και πέρα κρατάμε κάθε αλλαγή."
                : "Η καταγραφή απενεργοποιήθηκε.",
        );
    } catch {
        historyToggleInput.checked = !enabled;
        setHistoryNote("Η αλλαγή δεν ήταν δυνατή. Δοκιμάστε ξανά.", true);
    } finally {
        historyToggleInput.disabled = false;
    }
}

// Το backfill διαβάζει κάθε εξεταστική περίοδο ξεχωριστά, άρα φέρνει και
// προσπάθειες που δεν φαίνονται στην τρέχουσα βαθμολογία. Ο κωδικός
// χρησιμοποιείται μια φορά για αυτό το αίτημα και δεν αποθηκεύεται.
async function runBackfill() {
    const password = await openAppModal({
        title: "Εισαγωγή παλαιότερων βαθμών",
        message: "Θα διαβάσουμε όλες τις εξεταστικές περιόδους από το eduportal, μαζί με βαθμούς που δεν φαίνονται πια στην τρέχουσα βαθμολογία. Εισάγετε τον κωδικό σας — χρησιμοποιείται μόνο για αυτό και δεν αποθηκεύεται.",
        confirmLabel: "Εισαγωγή",
        input: true,
    });
    if (!password) return;

    historyBackfillBtn.disabled = true;
    setHistoryNote("Εισαγωγή από το eduportal... μπορεί να πάρει ένα λεπτό.");

    try {
        const response = await fetch(`${historyBaseUrl}/backfill`, {
            credentials: "include",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
        });
        const data = await response.json();

        if (response.status === 401) throw new Error("INVALID_CREDENTIALS");
        if (response.status === 429) throw new Error("RATE_LIMITED");
        if (!response.ok || !data.ok) throw new Error("BACKFILL_FAILED");

        await loadHistory();
        const failed = Array.isArray(data.failedPeriods) ? data.failedPeriods.length : 0;
        setHistoryNote(
            `Εισήχθησαν ${data.entries} εγγραφές από ${data.periods} εξεταστικές.` +
                (failed ? ` ${failed} εξεταστικές δεν διαβάστηκαν — δοκιμάστε ξανά αργότερα.` : ""),
            failed > 0,
        );
    } catch (error) {
        setHistoryNote(
            error.message === "INVALID_CREDENTIALS"
                ? "Λάθος κωδικός."
                : error.message === "RATE_LIMITED"
                  ? "Πολλές εισαγωγές σε λίγη ώρα. Δοκιμάστε ξανά σε μία ώρα."
                  : "Η εισαγωγή απέτυχε. Δοκιμάστε ξανά.",
            true,
        );
    } finally {
        historyBackfillBtn.disabled = false;
    }
}

historyToggleInput.addEventListener("change", () => {
    setHistoryEnabled(historyToggleInput.checked);
});
historyBackfillBtn.addEventListener("click", runBackfill);
historyFilter.addEventListener("change", renderHistory);

export { historyFilter, historyToggleInput, loadHistory, renderHistory, setHistoryNote };
