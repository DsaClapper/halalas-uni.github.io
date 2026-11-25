// js/refresh.js — ανανέωση δεδομένων, pull to refresh, έλεγχος έκδοσης.
import { appState, authBaseUrl, scrollHost } from "./state.js";
import { RELOGIN_MESSAGE, returnToLogin } from "./login.js";
import { filesLoaded, loadFiles } from "./files.js";
import { renderDashboardData } from "./main.js";

function setDashboardStatus(message, isError = false) {
    const status = document.getElementById("dashboardStatus");
    status.textContent = message;
    status.classList.toggle("is-error", isError);
}

// Πότε τραβήχτηκαν τα δεδομένα, σε σχετικό χρόνο: "πριν 2 ώρες" απαντά στο
// "είναι φρέσκα;" με μια ματιά, ενώ μια ημερομηνία θέλει να την αφαιρέσεις
// από την τρέχουσα ώρα στο μυαλό σου. Η ακριβής ώρα μένει στο tooltip.
let lastUpdatedAt = null;

function describeAge(then, now = Date.now()) {
    const seconds = Math.max(0, Math.round((now - then) / 1000));
    if (seconds < 60) return "μόλις τώρα";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `πριν ${minutes} ${minutes === 1 ? "λεπτό" : "λεπτά"}`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `πριν ${hours} ${hours === 1 ? "ώρα" : "ώρες"}`;
    const days = Math.round(hours / 24);
    return `πριν ${days} ${days === 1 ? "μέρα" : "μέρες"}`;
}

function paintLastUpdated() {
    const element = document.getElementById("lastUpdated");
    if (!lastUpdatedAt) {
        element.textContent = "";
        element.removeAttribute("title");
        return;
    }
    element.textContent = `Ενημερώθηκε ${describeAge(lastUpdatedAt)}`;
    element.title = new Intl.DateTimeFormat("el-GR", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(lastUpdatedAt));
}

function setLastUpdated() {
    lastUpdatedAt = Date.now();
    paintLastUpdated();
}

// Χωρίς αυτό το "πριν 2 λεπτά" θα έμενε για πάντα "πριν 2 λεπτά".
setInterval(paintLastUpdated, 60 * 1000);

// ------------------------------------------------------- Pull to refresh
// Γράφεται στο χέρι επειδή δεν το δίνει κανένας browser εδώ: το scroll
// γίνεται μέσα στο .sd-content και όχι στο document (το wrapper είναι
// 100dvh; overflow:hidden), και το native pull-to-refresh του Chrome
// δουλεύει μόνο σε document scroll. Το Safari σε display:standalone δεν
// το έχει καθόλου.
//
// Δεν κάνει location.reload(): χωρίς «Remember me» το φόρτωμα πάει στην
// οθόνη σύνδεσης, οπότε το gesture θα μπορούσε να σε αποσυνδέσει — κάτι
// που μια κίνηση που κάνεις αντανακλαστικά δεν επιτρέπεται να κάνει.
// Νέα έκδοση την προτείνει το μπάνερ, δεν την επιβάλλει το τράβηγμα.
const PULL_TRIGGER_PX = 70;
const PULL_MAX_PX = 110;
// Κάτω από αυτό δεν είναι τράβηγμα, είναι το τρέμουλο του δαχτύλου.
const PULL_START_PX = 8;

const pullIndicator = document.getElementById("pullIndicator");
let pullStartY = null;
let pullDistance = 0;
let pullArmed = false;
let pullRefreshing = false;

function setPull(distance) {
    pullDistance = distance;
    pullIndicator.style.transform = `translate(-50%, ${distance}px)`;
    pullIndicator.style.opacity = String(Math.min(1, distance / PULL_TRIGGER_PX));
    pullIndicator.classList.toggle("is-ready", distance >= PULL_TRIGGER_PX);
}

function resetPull() {
    pullStartY = null;
    pullArmed = false;
    pullIndicator.style.transition = "transform 0.25s ease, opacity 0.25s ease";
    setPull(0);
    setTimeout(() => (pullIndicator.style.transition = ""), 260);
}

scrollHost.addEventListener(
    "touchstart",
    (event) => {
        // Οπλίζει ΜΟΝΟ στην κορυφή και μόνο με ένα δάχτυλο. Αλλιώς το
        // gesture θα πυροδοτούνταν στη μέση ενός κανονικού scroll, που
        // είναι χειρότερο από το να μην υπάρχει καθόλου.
        if (pullRefreshing || scrollHost.scrollTop > 0 || event.touches.length !== 1) return;
        pullStartY = event.touches[0].clientY;
        pullArmed = false;
    },
    { passive: true }
);

scrollHost.addEventListener(
    "touchmove",
    (event) => {
        if (pullStartY === null || pullRefreshing) return;

        const delta = event.touches[0].clientY - pullStartY;
        // Τράβηγμα προς τα πάνω ή επιστροφή μέσα στο περιεχόμενο: ακύρωση.
        if (delta <= 0 || scrollHost.scrollTop > 0) {
            if (pullArmed) resetPull();
            pullStartY = null;
            return;
        }
        if (delta < PULL_START_PX) return;

        pullArmed = true;
        // Αντίσταση: το δάχτυλο τρέχει πιο γρήγορα από τον δείκτη, ώστε
        // να μη φτάνει το κατώφλι κατά λάθος.
        setPull(Math.min(PULL_MAX_PX, (delta - PULL_START_PX) * 0.5));
    },
    { passive: true }
);

scrollHost.addEventListener("touchend", async () => {
    if (!pullArmed || pullRefreshing) {
        if (pullArmed) resetPull();
        pullStartY = null;
        return;
    }

    const shouldRefresh = pullDistance >= PULL_TRIGGER_PX;
    pullStartY = null;
    if (!shouldRefresh) {
        resetPull();
        return;
    }

    pullRefreshing = true;
    pullIndicator.classList.add("is-spinning");
    setPull(PULL_TRIGGER_PX);
    try {
        await refreshDashboardData();
        // Το τράβηγμα είναι η στιγμή που ζητάς φρέσκα πράγματα — καλή
        // αφορμή να κοιτάξουμε και για νέα έκδοση.
        checkForUpdate();
    } finally {
        pullRefreshing = false;
        pullIndicator.classList.remove("is-spinning");
        resetPull();
    }
});

// ----------------------------------------------------- Έλεγχος έκδοσης
// Η σελίδα ξέρει την έκδοσή της (το deploy τη γράφει στο <meta name="app-version">)
// και το site λέει την τελευταία στο /version.json. Αν διαφέρουν, η σελίδα είναι
// παλιά — από την cache, ή ανοιχτή από πριν το deploy — και ξαναφορτώνει μόνη
// της, μία φορά. Ο service worker δεν αρκεί: στο iPhone, με την εφαρμογή στην
// αρχική οθόνη, άνοιξε παλιά σελίδα παρ' όλα αυτά (2026-11-23).
const pageVersion = document.querySelector('meta[name="app-version"]')?.content || "dev";
const RELOADED_FOR_KEY = "halalasReloadedForVersion";

async function readLiveVersion() {
    try {
        const response = await fetch("/version.json", { cache: "no-store" });
        if (!response.ok) return null;
        const data = await response.json();
        return typeof data.version === "string" ? data.version : null;
    } catch {
        return null;
    }
}

async function checkForUpdate() {
    // Τοπικά, χωρίς σφράγισμα, δεν υπάρχει έκδοση να συγκρίνουμε.
    if (pageVersion === "dev") return;
    const live = await readLiveVersion();
    if (!live || live === pageVersion) return;

    // Ένα ανοιχτό παράθυρο (επιβεβαίωση, κωδικός) δεν πετιέται. Και αν
    // ξαναφορτώσαμε ήδη για αυτή την έκδοση χωρίς να έρθει, δεν ξαναφορτώνουμε:
    // κανένα ατελείωτο ξαναφόρτωμα. Και στα δύο, η μπάρα «νέα έκδοση».
    let reloadedFor = null;
    try {
        reloadedFor = sessionStorage.getItem(RELOADED_FOR_KEY);
    } catch {
        reloadedFor = live; // χωρίς sessionStorage δεν ξέρουμε αν ξαναφορτώσαμε
    }
    if (!document.getElementById("appModal").hidden || reloadedFor === live) {
        document.getElementById("updateBanner").hidden = false;
        return;
    }
    try {
        sessionStorage.setItem(RELOADED_FOR_KEY, live);
    } catch {
        document.getElementById("updateBanner").hidden = false;
        return;
    }
    location.reload();
}

document.getElementById("updateReloadBtn").addEventListener("click", () => location.reload());

// Ο service worker (sw.js) φέρνει φρέσκια σελίδα σε κάθε άνοιγμα, όχι μόνο
// σε όσους άνοιξαν ειδοποιήσεις. Ίδιο URL με το getPushSubscription, ώστε
// να μένει μία καταχώρηση.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

// Στο άνοιγμα, και όταν επιστρέφεις στην εφαρμογή: η στιγμή που ένα deploy
// μπορεί να έχει μεσολαβήσει χωρίς να το ξέρεις.
checkForUpdate();
// Μια εφαρμογή στην αρχική οθόνη του κινητού δεν ξαναφορτώνει όταν την
// ανοίγεις — απλώς ξυπνάει. Αν έχει περάσει ώρα, φέρνουμε φρέσκα δεδομένα.
const REFRESH_ON_RETURN_AFTER_MS = 15 * 60 * 1000;
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    checkForUpdate();
    if (appState.dashboardReady && appState.currentData && (!lastUpdatedAt || Date.now() - lastUpdatedAt > REFRESH_ON_RETURN_AFTER_MS)) {
        refreshDashboardData({ silent: true });
    }
});

// Μία ανανέωση τη φορά: η αθόρυβη του ανοίγματος και ένα τράβηγμα αμέσως
// μετά θα έκαναν δύο login στο eduportal για το ίδιο πράγμα.
let refreshInFlight = null;

// `silent`: η αυτόματη ανανέωση (άνοιγμα, επιστροφή στην εφαρμογή). Δεν
// γράφει «Ανανέωση...» ούτε σφάλματα — δεν τη ζήτησες, και αν αποτύχει
// απλώς μένουν τα δεδομένα που ήδη βλέπεις.
function refreshDashboardData(options = {}) {
    if (!appState.currentData) return Promise.resolve();
    if (refreshInFlight) {
        // Αν περιμένει ήδη μια αθόρυβη και πατήσεις το κουμπί, να φαίνεται.
        if (!options.silent) setDashboardStatus("Ανανέωση δεδομένων...");
        return refreshInFlight;
    }
    refreshInFlight = runRefresh(options).finally(() => {
        refreshInFlight = null;
    });
    return refreshInFlight;
}

function sameDashboardData(a, b) {
    const pick = (d) => JSON.stringify([d.user, d.courses, d.eduportalGrades, d.assignments ?? null]);
    return Boolean(a && b) && pick(a) === pick(b);
}

async function runRefresh({ silent = false } = {}) {
    const refreshButton = document.getElementById("refreshBtn");
    refreshButton.disabled = true;
    if (!silent) setDashboardStatus("Ανανέωση δεδομένων...");
    const attemptAtStart = appState.loginAttempt;

    try {
        // /auth/session επιστρέφει το στιγμιότυπο του login και δεν
        // ξαναρωτάει ποτέ — γι' αυτό ένας βαθμός που βγήκε μετά τη
        // σύνδεση έμενε αόρατος όσο κι αν πατούσες «Ανανέωση».
        // Το /auth/refresh πηγαίνει όντως στο Moodle και στο eduportal.
        const response = await fetch(`${authBaseUrl}/refresh`, {
            method: "POST",
            credentials: "include",
        });
        const data = await response.json();

        // Έκανες sign out όσο έτρεχε: η απάντηση είναι του προηγούμενου.
        if (attemptAtStart !== appState.loginAttempt || !appState.currentData) return;
        if (response.status === 429) throw new Error("RATE_LIMITED");
        if (response.status === 401) {
            returnToLogin(data.code === "RELOGIN_REQUIRED" ? RELOGIN_MESSAGE : "Η σύνδεση έληξε. Συνδέσου ξανά.");
            return;
        }
        if (!response.ok || !data.ok) throw new Error("REFRESH_FAILED");

        // Τις περισσότερες φορές δεν έχει αλλάξει τίποτα. Τότε δεν ξαναζωγραφίζουμε:
        // μια αθόρυβη ανανέωση που φτάνει ενώ κυλάς ή έχεις πατήσει μια
        // κάρτα θα σου πετούσε το scroll για να δείξει τα ίδια πράγματα.
        if (sameDashboardData(appState.currentData, data)) {
            appState.currentData = data;
        } else {
            renderDashboardData(data, true);
        }
        setLastUpdated();
        // Το /auth/refresh πέταξε και τη λίστα αρχείων του server· αν την
        // είχες ανοίξει, την ξαναφέρνουμε για να μη δείχνει την παλιά.
        if (filesLoaded()) loadFiles({ refresh: true });

        // Μια ανανέωση που δεν μπόρεσε να διαβάσει τους επίσημους βαθμούς
        // πρέπει να το πει. Αλλιώς κοιτάς μια οθόνη που μόλις «ανανεώθηκε»
        // και συμπεραίνεις ότι δεν βγήκε τίποτα — που μπορεί να μην ισχύει.
        // `officialRecent`: διαβάστηκαν πριν λίγα λεπτά (ο server δεν κάνει
        // νέο login στο eduportal πιο συχνά από κάθε 10'), άρα είναι φρέσκοι.
        const official = (data.refreshed && data.refreshed.official) || data.officialRecent === true;
        // Το ίδιο για το eLearn, και εδώ ακόμα και στην αθόρυβη ανανέωση του
        // ανοίγματος: εκεί ακριβώς ψάχνεις έναν βαθμό που μόλις είδες στο eLearn
        // (2026-11-24: δεν απάντησε, και η εφαρμογή έδειχνε τα παλιά σιωπηλά).
        const moodle = !(data.refreshed && data.refreshed.moodle === false);
        const elearnNote = moodle ? "" : "Το eLearn δεν απάντησε· οι βαθμοί του Moodle είναι από την τελευταία επιτυχή ανάγνωση.";
        if (silent) {
            if (!moodle) setDashboardStatus(elearnNote, true);
            else if (official) setDashboardStatus("");
            return;
        }
        const officialNote = official
            ? ""
            : data.officialRefreshable === false
              ? "Οι επίσημοι βαθμοί δεν ανανεώθηκαν — άνοιξε τις ειδοποιήσεις για να γίνεται αυτόματα."
              : "Το eduportal δεν απάντησε· οι επίσημοι βαθμοί είναι από την τελευταία επιτυχή ανάγνωση.";
        const note = [elearnNote, officialNote].filter(Boolean).join(" ");
        setDashboardStatus(note, Boolean(note));
    } catch (error) {
        if (silent) return;
        setDashboardStatus(
            error.message === "RATE_LIMITED"
                ? "Πολλές προσπάθειες. Δοκιμάστε ξανά αργότερα."
                : "Η ανανέωση απέτυχε. Δοκιμάστε ξανά.",
            true,
        );
    } finally {
        refreshButton.disabled = false;
    }
}

// Το κουμπί δεν είχε ποτέ listener: η refreshDashboardData καλούνταν μόνο
// από το pull-to-refresh, και το «Ανανέωση» του toolbar ήταν διακοσμητικό.
// Γι' αυτό «δοκίμασα και Ανανέωση» δεν άλλαξε τίποτα — δεν έτρεχε καν ο
// άχρηστος κύκλος που περιέγραφα, δεν έτρεχε τίποτα.
document.getElementById("refreshBtn").addEventListener("click", () => {
    refreshDashboardData();
});

export { refreshDashboardData, setDashboardStatus, setLastUpdated };
