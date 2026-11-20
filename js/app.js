// js/app.js — εκκίνηση της εφαρμογής και το dashboard που τα δένει όλα.
import { appState, rememberSessionKey, scrollHost } from "./state.js";
import { preparePushNotifications } from "./notifications.js";
import { restoreSession, returnToLogin } from "./login.js";
import { renderSummary } from "./summary.js";
import { setDashboardStatus, setLastUpdated } from "./refresh.js";
import { renderGrades, restoreTab } from "./grades.js";
import { applyAssignmentsPayload, loadAssignments } from "./assignments.js";
import { loadHistory } from "./history.js";

let messages = [];

// `isRefresh` σημαίνει «το dashboard είναι ήδη στην οθόνη». Χωρίς αυτό, το
// renderStudentDashboard έπαιζε την οθόνη φόρτωσης σε ΚΑΘΕ ανανέωση — που
// δεν φαινόταν όσο η ανανέωση ήταν ένα κουμπί που πατάς σπάνια, αλλά με το
// pull-to-refresh έγινε αναλαμπή σε κάθε τράβηγμα.
function renderDashboardData(data, isRefresh = false) {
    appState.currentData = data;
    renderStudentDashboard(data, isRefresh);
    renderGrades(data);
    renderSummary(data);
    preparePushNotifications();
    loadHistory();
    // Το /auth/session κουβαλάει ήδη τις εκκρεμότητες, οπότε ζωγραφίζουμε
    // κατευθείαν από αυτό και γλιτώνουμε ένα request. Το loadAssignments()
    // μένει για το κουμπί και για την περίπτωση που λείπει το πεδίο (π.χ.
    // frontend νεότερο από το backend που τρέχει).
    if (data.assignments !== undefined) {
        applyAssignmentsPayload({ available: data.assignments !== null, assignments: data.assignments });
    } else {
        loadAssignments();
    }
    // Μετά το πρώτο render, όχι πριν: αν το tab επιλεγόταν με άδεια panels
    // θα κουνούσε το scroll σε περιεχόμενο που δεν υπάρχει ακόμα.
    restoreTab();
}
function updateHeaderShrink() {
    const offset = scrollHost === window ? window.scrollY : scrollHost.scrollTop;
    document.body.classList.toggle("is-scrolled", offset > 24);
}
scrollHost.addEventListener("scroll", updateHeaderShrink, { passive: true });
updateHeaderShrink();

function renderStudentDashboard(responseData, isRefresh = false) {
    const user = responseData.user;

    if (!user) return;

    appState.dashboardReady = true;
    setDashboardStatus("");
    setLastUpdated();

    // Συμπλήρωση στοιχείων φοιτητή (πάνω δεξιά)
    document.getElementById("sdStudentName").textContent = user.fullName;
    document.getElementById("sdStudentID").textContent = user.ID;

    // Εμφάνιση του Dashboard (χρησιμοποιούμε flex για να δουλεύει σωστά το scroll)
    if (!isRefresh) RenderloadingScreen("collectDataEnd");
    // $(".dashboard-loader-wrapper").fadeOut("fast", () => {
    //     document.body.style.overflow = "hidden";
    //     // document.getElementById("studentDashboardBlock").style.display = "flex";
    //     document.getElementById("studentDashboardBlock").style.display = "flex";
    //     $("#studentDashboardBlock").fadeIn("fast");
    // });
}

function RenderloadingScreen(state) {
    const currentLoaderRunId = ++appState.loaderRunId;
    const step = $(".step");
    const progress = $(".progress");
    const percentText = $("#percent");
    const messageText = $(".message");
    const spinner = $(".spinner");

    step.removeAttr("style");
    spinner.removeAttr("style").empty();
    progress.css("width", "0%");
    percentText.text("0%");
    let current = 0;
    if (state === "login") {
        messages = ["Συλλογή μαθημάτων...", "Συλλογή επίσημων βαθμών..."];
        messageText.text("Έλεγχος στοιχείων σύνδεσης...");
    } else if (state === "collectDataEnd") {
        current = messages.length;
    }
    function runLoader() {
        if (currentLoaderRunId !== appState.loaderRunId) return;

        if (current >= messages.length) {
            if (!appState.dashboardReady) return;

            spinner.html("✓");
            spinner.css({
                animation: "none",
                border: "none",
                color: "#4ade80",
                fontSize: "18px",
            });

            messageText.text("Τα δεδομένα είναι έτοιμα.");
            progress.css("width", "100%");
            percentText.text("100%");
            $(".dashboard-loader-wrapper").fadeOut("fast", () => {
                document.body.style.overflow = "hidden";
                document.body.classList.add("dashboard-mode");
                // document.getElementById("studentDashboardBlock").style.display = "flex";
                document.getElementById("studentDashboardBlock").style.display =
                    "flex";
                $("#studentDashboardBlock").fadeIn("fast");
            });
            return;
        }

        step.css({
            opacity: "0",
            transform: "translateY(10px)",
        });
        setTimeout(() => {
            if (currentLoaderRunId !== appState.loaderRunId) return;

            messageText.text(messages[current]);

            step.css({
                opacity: "1",
                transform: "translateY(0)",
            });

            const percent = ((current + 1) / messages.length) * 100;

            progress.css("width", percent + "%");
            percentText.text(Math.round(percent) + "%");

            current++;

            setTimeout(runLoader, 1400);
        }, 300);
    }

    setTimeout(runLoader, state === "collectDataEnd" ? 0 : 700);
    document.getElementById("dashboard-loader-wrapper").style.display =
        "flex";
}

if (localStorage.getItem(rememberSessionKey) === "true") {
    restoreSession();
} else {
    returnToLogin();
}

export { RenderloadingScreen, renderDashboardData };
