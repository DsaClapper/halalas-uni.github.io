// js/state.js — κοινή κατάσταση και σταθερές. Δεν κάνει κανένα import.

const authBaseUrl = "https://uni-api.halalas-services.xyz/auth";
const rememberSessionKey = "halalasRememberSession";
const notificationsBaseUrl = "https://uni-api.halalas-services.xyz/notifications";
const notificationsEnabledKey = "halalasNotificationsEnabled";
// Το ύψος του body ήταν καρφωμένο σε window.innerHeight με JavaScript, που
// σε κινητό αλλάζει κάθε φορά που κρύβεται ή εμφανίζεται η μπάρα του
// browser — κλασική πηγή για κομμένο περιεχόμενο και διπλό scrollbar.
// Το `100dvh` στο CSS κάνει το ίδιο πράγμα σωστά και χωρίς listener.

// Η κεφαλίδα κρατάει 210px σε desktop και ~120px σε κινητό για ένα
// λογότυπο. Μαζεύεται μόλις αρχίσεις να κυλάς, οπότε ο χώρος πάει σε αυτό
// που ήρθες να δεις.
const scrollHost = document.querySelector(".sd-content") || window;

// Μεταβλητές που αλλάζουν από περισσότερα από ένα modules: ένα module
// δεν μπορεί να ξαναδώσει τιμή σε κάτι που έκανε import, άρα ζουν εδώ ως
// ιδιότητες ενός αντικειμένου.
export const appState = {
    loginAttempt: 0,
    dashboardReady: false,
    loaderRunId: 0,
    currentData: null,
    notificationSetupPromise: null,
    // Το φίλτρο μαθήματος δεν αποθηκεύεται: αν το βρεις ενεργό αύριο θα
    // νομίζεις ότι εξαφανίστηκαν οι μισές προθεσμίες. Η προβολή αποθηκεύεται.
    assignmentsCourse: "",
    historyEntries: [],
    historyEnabled: false,
};

export { authBaseUrl, notificationsBaseUrl, notificationsEnabledKey, rememberSessionKey, scrollHost };
