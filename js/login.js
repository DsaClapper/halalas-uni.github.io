// js/login.js — σύνδεση, επαναφορά συνεδρίας, αποσύνδεση.
import { appState, authBaseUrl, notificationsEnabledKey, rememberSessionKey } from "./state.js";
import { openAppModal } from "./modal.js";
import { notificationToggleInput, supportsPushNotifications, unsubscribePush } from "./notifications.js";
import { refreshDashboardData } from "./refresh.js";
import { DEFAULT_TAB, gradeSectionOpen, gradesFilter, gradesSearch, selectTab } from "./grades.js";
import { historyFilter, historyToggleInput, setHistoryNote } from "./history.js";
import { resetFiles } from "./files.js";
import { RenderloadingScreen, renderDashboardData } from "./main.js";

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const rememberInput = document.getElementById("remember");
const loginStatus = document.getElementById("loginStatus");

function setLoginStatus(message) {
    loginStatus.textContent = message;
    loginStatus.hidden = !message;
}

// Ένα δεύτερο Enter ή διπλό πάτημα όσο περιμένουμε θα έστελνε δεύτερο
// login, που μετράει στο όριο προσπαθειών του server.
let loginInFlight = false;

async function startLogin(username, password) {
    if (loginInFlight) return;
    if (!username || !password) {
        setLoginStatus("Συμπλήρωσε όνομα χρήστη και κωδικό.");
        return;
    }
    loginInFlight = true;
    try {
        await sendLogin(username, password);
    } finally {
        loginInFlight = false;
    }
}

async function sendLogin(username, password) {
    const attemptId = ++appState.loginAttempt;
    appState.dashboardReady = false;
    setLoginStatus("");
    if (rememberInput.checked) {
        localStorage.setItem(rememberSessionKey, "true");
    } else {
        localStorage.removeItem(rememberSessionKey);
    }
    appState.loaderRunId++;
    $(".dashboard-loader-wrapper").stop(true, true).hide();
    $("#loginWrapper").stop(true, true).fadeOut(300, () => {
        if (attemptId === appState.loginAttempt && !appState.dashboardReady) {
            RenderloadingScreen("login");
        }
    });

    try {
        const response = await fetch(`${authBaseUrl}/login`, {
            credentials: "include",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username,
                password,
                remember: rememberInput.checked,
            }),
        });
        const data = await response.json();
        if (attemptId !== appState.loginAttempt) return;
        if (response.status === 401) returnToLogin("Λάθος στοιχεία σύνδεσης.");
        else if (response.status === 429) returnToLogin("Πολλές προσπάθειες, δοκίμασε ξανά σε λίγο.");
        else if (!response.ok || !data.ok) returnToLogin(data.message || "Δεν ήταν δυνατή η σύνδεση.");
        else renderDashboardData(data);
    } catch {
        if (attemptId === appState.loginAttempt) returnToLogin("Δεν ήταν δυνατή η σύνδεση. Δοκίμασε ξανά.");
    }
}

const RELOGIN_MESSAGE =
    "Η εφαρμογή ενημερώθηκε: πλέον οι βαθμοί ανανεώνονται μόνοι τους. Συνδέσου ξανά μία φορά (με «Remember me») για να ενεργοποιηθεί.";

async function restoreSession() {
    RenderloadingScreen("login");

    try {
        const response = await fetch(`${authBaseUrl}/session`, {
            credentials: "include",
        });
        const data = await response.json();

        if (response.ok && data.ok) {
            renderDashboardData(data);
            // Το /auth/session είναι το στιγμιότυπο που κράτησε ο server —
            // με «Remember me» μπορεί να είναι εβδομάδων. Το δείχνουμε
            // αμέσως για να μην περιμένεις, και φέρνουμε τα φρέσκα από πίσω.
            // Χωρίς αυτό, νέα δεδομένα έβλεπες μόνο με sign out και login.
            refreshDashboardData({ silent: true });
        } else if (response.status === 401 && data.code === "RELOGIN_REQUIRED") {
            // Συνδέσεις από πριν την αυτόματη ανανέωση: ο server δεν έχει
            // τρόπο να ξαναδιαβάσει τους επίσημους βαθμούς τους, οπότε
            // ζητάει ένα login ακόμα. Λέμε το γιατί, να μη μοιάζει με βλάβη.
            returnToLogin(RELOGIN_MESSAGE);
        } else if (response.status === 401) {
            returnToLogin();
        } else {
            returnToLogin(data.message || "Δεν ήταν δυνατή η επαναφορά της σύνδεσης.");
        }
    } catch {
        returnToLogin("Δεν ήταν δυνατή η σύνδεση με τον server.");
    }
}

document.getElementById("loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    startLogin(usernameInput.value.trim(), passwordInput.value);
});

function returnToLogin(message = "") {
    appState.loginAttempt++;
    appState.dashboardReady = false;
    appState.currentData = null;
    appState.loaderRunId++;
    // Ο επόμενος που θα συνδεθεί μπορεί να είναι άλλος φοιτητής.
    resetFiles();
    document.body.classList.remove("dashboard-mode");
    document.body.style.overflow = "hidden";
    setLoginStatus(message);
    $(".dashboard-loader-wrapper").stop(true, true).fadeOut(150);
    $("#studentDashboardBlock").stop(true, true).fadeOut(200);
    $(".login-wrapper").stop(true, true).fadeIn(250);
}

document.getElementById("signOutBtn").addEventListener("click", async () => {
    const shouldSignOut = await openAppModal({
        title: "Έξοδος από τον λογαριασμό",
        message: "Θέλετε να αποσυνδεθείτε από το Halalas University Portal;",
        confirmLabel: "Sign out",
    });
    if (!shouldSignOut) return;
    signOut();
});

// Χωριστά από το κουμπί, ώστε να την καλεί και το «Σύνδεση ξανά» των
// Αρχείων χωρίς το παράθυρο επιβεβαίωσης: εκεί το logout είναι αυτό που
// ζήτησες πατώντας, δεν χρειάζεται δεύτερη ερώτηση.
function signOut() {
    appState.loginAttempt++;
    appState.dashboardReady = false;
    appState.loaderRunId++;
    fetch(`${authBaseUrl}/logout`, {
        credentials: "include",
        method: "POST",
    }).catch(() => {});

    document.body.classList.remove("dashboard-mode");
    document.body.style.overflow = "hidden";
    $("#studentDashboardBlock").stop(true, true).fadeOut(250, () => {
            document.getElementById("sdStudentName").textContent = "Φόρτωση...";
            document.getElementById("sdStudentID").textContent = "-";
            document.getElementById("sdGradesGrid").innerHTML = "";
            document.getElementById("sdHistoryTimeline").innerHTML = "";
            appState.historyEntries = [];
            appState.historyEnabled = false;
            gradesSearch.value = "";
            gradesFilter.query = "";
            appState.assignmentsCourse = "";
            gradeSectionOpen.clear();
            historyToggleInput.checked = false;
            historyFilter.innerHTML = `<option value="">Όλα τα μαθήματα</option>`;
            setHistoryNote("");
            $(".dashboard-loader-wrapper").stop(true, true).hide();
            selectTab(DEFAULT_TAB, { remember: false });
            passwordInput.value = "";
            usernameInput.value = "";
            rememberInput.checked = false;
            localStorage.removeItem(rememberSessionKey);
            appState.currentData = null;
            appState.notificationSetupPromise = null;
            notificationToggleInput.checked = false;
            // Η αποσύνδεση σταματά τις ειδοποιήσεις σε αυτή τη συσκευή (ο
            // server σβήνει τη συνδρομή της)· εδώ φεύγει και το τοπικό κομμάτι.
            localStorage.removeItem(notificationsEnabledKey);
            if (supportsPushNotifications()) unsubscribePush().catch(() => {});
            resetFiles();
            $(".login-wrapper").stop(true, true).fadeIn(250);
    });
}

export { RELOGIN_MESSAGE, restoreSession, returnToLogin, signOut };
