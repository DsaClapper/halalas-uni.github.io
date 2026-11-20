// js/summary.js — η σύνοψη στην κορυφή του dashboard.
import { isStale } from "./assignments.js";

// ------------------------------------------------------------- Σύνοψη
// Μόνο από τους επίσημους βαθμούς. Το Moodle κρατάει προσωρινά σύνολα που
// αλλάζουν μέσα στο εξάμηνο — ένας μέσος όρος χτισμένος πάνω τους θα
// κουνιόταν χωρίς να έχει περάσει κανένα μάθημα.
//
// Σταθμισμένος με ECTS, γιατί αυτό μετράει για το πτυχίο. Αν λείπουν ECTS
// από κάποιο μάθημα πέφτει σε απλό μέσο όρο και το λέει, αντί να βγάλει
// σιωπηλά νούμερο που δεν σημαίνει αυτό που νομίζεις.
//
// Το eduportal λέει το ίδιο ποια μαθήματα μετράνε: ένα περασμένο μάθημα
// μπορεί να μην μπαίνει στον βαθμό πτυχίου ή να μην δίνει ECTS για το
// πτυχίο. Όταν η σημαία λείπει (παλιά δεδομένα) το μάθημα μετράει, όπως
// πριν.
const countsInAverage = (c) => c.countsTowardDegreeGrade !== false;
const countsInDiploma = (c) => c.countsTowardDiploma !== false;

function computeSummary(data) {
    const official = Array.isArray(data.eduportalGrades) ? data.eduportalGrades : [];
    const graded = official.filter((c) => c.grade !== null && c.grade !== undefined && c.isPassed);
    const averaged = graded.filter(countsInAverage);

    const weights = averaged.map((c) => Number(c.ects) || 0);
    const weighted = weights.every((w) => w > 0);

    let average = null;
    if (averaged.length > 0) {
        average = weighted
            ? averaged.reduce((sum, c, i) => sum + Number(c.grade) * weights[i], 0) /
              weights.reduce((sum, w) => sum + w, 0)
            : averaged.reduce((sum, c) => sum + Number(c.grade), 0) / averaged.length;
    }

    // Ίδιος ορισμός με τον μετρητή δίπλα στις «Εκκρεμότητες» — δύο νούμερα
    // που λένε το ίδιο πράγμα πρέπει να συμφωνούν, αλλιώς το ένα από τα δύο
    // είναι ψέμα.
    const now = Date.now();
    const pending = Array.isArray(data.assignments)
        ? data.assignments.filter((a) => !a.submitted && !isStale(a, now)).length
        : null;

    return {
        average,
        weighted,
        passed: graded.length,
        total: official.length,
        ects: graded.filter(countsInDiploma).reduce((sum, c) => sum + (Number(c.ects) || 0), 0),
        pending,
    };
}

function renderSummary(data) {
    const panel = document.getElementById("sdSummary");
    const summary = computeSummary(data);

    // Χωρίς έναν επίσημο βαθμό δεν υπάρχει τίποτα αληθινό να δείξουμε, και
    // τέσσερις παύλες είναι χειρότερες από καθόλου λωρίδα.
    if (summary.total === 0) {
        panel.hidden = true;
        return;
    }
    panel.hidden = false;

    document.getElementById("summaryAverage").textContent =
        summary.average === null ? "—" : summary.average.toFixed(2);
    document.getElementById("summaryAverageLabel").textContent = summary.weighted
        ? "Μέσος όρος (ECTS)"
        : "Μέσος όρος";
    document.getElementById("summaryPassed").textContent = `${summary.passed}/${summary.total}`;
    document.getElementById("summaryEcts").textContent = String(summary.ects);

    const pendingItem = document.getElementById("summaryPendingItem");
    pendingItem.hidden = summary.pending === null;
    if (summary.pending !== null) {
        document.getElementById("summaryPending").textContent = String(summary.pending);
        pendingItem.classList.toggle("is-urgent", summary.pending > 0);
    }
}

export { countsInAverage, countsInDiploma, renderSummary };
