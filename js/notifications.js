// js/notifications.js — push ειδοποιήσεις και ο διακόπτης τους.
import { appState, notificationsBaseUrl, notificationsEnabledKey } from "./state.js";
import { openAppModal } from "./modal.js";
import { setDashboardStatus } from "./refresh.js";

const notificationToggle = document.getElementById("notificationToggle");
const notificationToggleInput = document.getElementById("notificationToggleInput");

function supportsPushNotifications() {
    return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)));
}

async function getPushSubscription() {
    if (!supportsPushNotifications()) return null;

    if (Notification.permission === "denied") return null;
    const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    if (permission !== "granted") return null;

    const registration = await navigator.serviceWorker.register("/sw.js");
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
        const keyResponse = await fetch(`${notificationsBaseUrl}/vapid-public-key`, {
            credentials: "include",
        });
        const keyData = await keyResponse.json();
        if (!keyResponse.ok || !keyData.ok || !keyData.publicKey) {
            throw new Error("VAPID_KEY_FAILED");
        }

        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
        });
    }

    const subscribeResponse = await fetch(`${notificationsBaseUrl}/subscribe`, {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    if (!subscribeResponse.ok) throw new Error("SUBSCRIBE_FAILED");
    return subscription;
}

// Ειδοποιήσεις μόνο όσο είσαι συνδεδεμένος με «Remember me», όπως σε κάθε
// εφαρμογή: χωρίς αυτό ο διακόπτης μένει κλειστός και λέει τι λείπει.
// Ένας παλιός server δεν στέλνει το πεδίο· τότε επιτρέπεται.
function notificationsAllowed() {
    return !appState.currentData || appState.currentData.notificationsAllowed !== false;
}

function updateNotificationToggle() {
    if (!supportsPushNotifications()) {
        notificationToggle.hidden = true;
        return;
    }

    notificationToggle.hidden = false;
    const allowed = notificationsAllowed();
    document.getElementById("notificationHint").textContent = allowed
        ? "Μάθε για νέο βαθμό ή προθεσμία χωρίς να μπαίνεις"
        : "Συνδέσου με «Remember me» για να λαμβάνεις ειδοποιήσεις.";
    if (!allowed) {
        notificationToggleInput.disabled = true;
        notificationToggleInput.checked = false;
        return;
    }
    if (!notificationToggleBusy) notificationToggleInput.disabled = false;
    // Μια αλλαγή σε εξέλιξη έχει ήδη βάλει τον διακόπτη εκεί που πάει.
    if (notificationToggleBusy) return;
    notificationToggleInput.checked = localStorage.getItem(notificationsEnabledKey) === "true";
}

function setNotificationToggle(on) {
    notificationToggleInput.checked = on;
    if (on) localStorage.setItem(notificationsEnabledKey, "true");
    else localStorage.removeItem(notificationsEnabledKey);
}

// Η συνδρομή αυτής της συσκευής, χωρίς να ζητηθεί άδεια και χωρίς να
// στηθεί service worker αν δεν υπάρχει ήδη.
async function currentPushEndpoint() {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    return subscription ? subscription.endpoint : "";
}

// Αλλάζει κάθε φορά που ο χρήστης πατάει τον διακόπτη: μια απάντηση του
// server που ξεκίνησε πριν από το πάτημα δεν πρέπει να το αναιρέσει.
let notificationToggleTouches = 0;
// Όσο τρέχει μια ενεργοποίηση ή απενεργοποίηση, ο διακόπτης δεν πατιέται
// και τίποτα άλλο δεν τον μετακινεί.
let notificationToggleBusy = false;

async function preparePushNotifications() {
    if (!supportsPushNotifications()) return;
    // Πρώτα ό,τι θυμάται η συσκευή, για να μην περιμένει ο διακόπτης το δίκτυο.
    updateNotificationToggle();
    if (!notificationsAllowed()) return;
    const touches = notificationToggleTouches;

    // Restore an existing opt-in silently, without requesting permission on page load.
    if (
        localStorage.getItem(notificationsEnabledKey) === "true" &&
        Notification.permission === "granted"
    ) {
        appState.notificationSetupPromise = getPushSubscription().catch(() => null);
        await appState.notificationSetupPromise;
    }

    // Χωρίς άδεια δεν φτάνει καμία ειδοποίηση εδώ, ό,τι κι αν λέει ο server.
    if (Notification.permission !== "granted") {
        if (touches === notificationToggleTouches && !notificationToggleBusy) setNotificationToggle(false);
        return;
    }

    // Η αλήθεια είναι στον server: ο διακόπτης μπορεί να έκλεισε από άλλη
    // συσκευή, ή η συσκευή αυτή να έχασε τη συνδρομή της. Αν ο server δεν
    // απαντήσει, μένει ό,τι θυμόμασταν.
    try {
        const endpoint = await currentPushEndpoint();
        const response = await fetch(`${notificationsBaseUrl}/status`, {
            credentials: "include",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(endpoint ? { endpoint } : {}),
        });
        const data = await response.json();
        if (!response.ok || !data.ok || touches !== notificationToggleTouches || notificationToggleBusy) return;
        setNotificationToggle(data.enabled === true && data.deviceSubscribed === true);
    } catch {
        // Εκτός δικτύου ή παλιό backend: δεν αλλάζει τίποτα.
    }
}

async function requestEnableNotifications(body) {
    const response = await fetch(`${notificationsBaseUrl}/enable`, {
        credentials: "include",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    const code = data.code || (response.status === 429 ? "RATE_LIMITED" : undefined);
    return { ok: response.ok && data.ok === true, code };
}

// Ένας διακόπτης που γυρίζει πίσω χωρίς λέξη μοιάζει χαλασμένος.
const NOTIFICATION_ERRORS = {
    PUSH_BLOCKED: "Οι ειδοποιήσεις είναι αποκλεισμένες για αυτή τη σελίδα. Επίτρεψέ τες από τις ρυθμίσεις του browser.",
    RATE_LIMITED: "Πολλές προσπάθειες. Δοκίμασε ξανά σε ένα λεπτό.",
    UPSTREAM_ERROR: "Το eLearn δεν απαντά αυτή τη στιγμή. Δοκίμασε ξανά αργότερα.",
    REMEMBER_REQUIRED: "Συνδέσου ξανά με «Remember me» για να λαμβάνεις ειδοποιήσεις.",
    INVALID_CREDENTIALS: "Το eLearn δεν δέχτηκε τον κωδικό σου. Συνδέσου ξανά.",
};

async function unregisterPushWorker() {
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) return;

    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    await registration.unregister();
}

async function setNotificationsEnabled(enabled) {
    if (notificationToggleBusy) return;
    notificationToggleBusy = true;
    notificationToggleInput.disabled = true;
    notificationToggleTouches++;
    setDashboardStatus("");
    try {
        await changeNotifications(enabled);
    } finally {
        notificationToggleBusy = false;
        notificationToggleInput.disabled = !notificationsAllowed();
    }
}

async function changeNotifications(enabled) {
    if (enabled) {
        // Ο server έχει ήδη τον κωδικό της σύνδεσης «Remember me»
        // (σφραγισμένο), οπότε δεν τον ζητάμε ποτέ· μόνο τη συναίνεση να
        // τον κρατήσει.
        const confirmed = await openAppModal({
            title: "Ενεργοποίηση ειδοποιήσεων",
            message: "Για να ελέγχουμε τους βαθμούς σας στο παρασκήνιο, ο κωδικός σας θα μείνει αποθηκευμένος κρυπτογραφημένος στον server. Μπορείτε να τις απενεργοποιήσετε όποτε θέλετε.",
            confirmLabel: "Ενεργοποίηση",
        });
        if (!confirmed) {
            notificationToggleInput.checked = false;
            return;
        }

        try {
            const subscription = await getPushSubscription();
            if (!subscription) throw new Error("PUSH_BLOCKED");
            const result = await requestEnableNotifications({});
            if (!result.ok) throw new Error(result.code || "ENABLE_FAILED");
            setNotificationToggle(true);
        } catch (error) {
            setNotificationToggle(false);
            setDashboardStatus(
                NOTIFICATION_ERRORS[error.message] || "Οι ειδοποιήσεις δεν ενεργοποιήθηκαν. Δοκίμασε ξανά.",
                true,
            );
        }
        return;
    }

    try {
        // Κλείνει μόνο αυτή η συσκευή· οι άλλες σου συνεχίζουν.
        const endpoint = await currentPushEndpoint().catch(() => "");
        const response = await fetch(`${notificationsBaseUrl}/disable`, {
            credentials: "include",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(endpoint ? { endpoint } : {}),
        });
        if (!response.ok) throw new Error("DISABLE_FAILED");
        await unregisterPushWorker();
        appState.notificationSetupPromise = null;
        setNotificationToggle(false);
    } catch {
        notificationToggleInput.checked = true;
        setDashboardStatus("Οι ειδοποιήσεις δεν απενεργοποιήθηκαν. Δοκίμασε ξανά.", true);
    }
}
notificationToggleInput.addEventListener("change", () => {
    setNotificationsEnabled(notificationToggleInput.checked);
});

export { notificationToggleInput, preparePushNotifications, supportsPushNotifications, unregisterPushWorker };
