// js/modal.js — το παράθυρο διαλόγου της εφαρμογής (επιβεβαίωση, κωδικός).

const appModal = document.getElementById("appModal");
const appModalTitle = document.getElementById("appModalTitle");
const appModalMessage = document.getElementById("appModalMessage");
const appModalInputGroup = document.getElementById("appModalInputGroup");
const appModalInput = document.getElementById("appModalInput");
const appModalConfirm = document.getElementById("appModalConfirm");
let modalResolve = null;

function closeAppModal(result = null) {
    if (!modalResolve) return;
    const resolve = modalResolve;
    modalResolve = null;
    appModal.classList.remove("is-visible");
    setTimeout(() => {
        // Αν στο μεταξύ άνοιξε επόμενο modal, το παράθυρο είναι πια δικό του.
        if (modalResolve) return;
        appModal.hidden = true;
        appModalInput.value = "";
    }, 180);
    resolve(result);
}

function openAppModal({ title, message, confirmLabel = "Συνέχεια", input = false }) {
    // Ένα παράθυρο που ανοίγει πάνω σε άλλο απαντά «άκυρο» στο πρώτο·
    // αλλιώς όποιος περίμενε εκείνη την απάντηση θα περίμενε για πάντα.
    if (modalResolve) {
        const previous = modalResolve;
        modalResolve = null;
        previous(null);
    }
    return new Promise((resolve) => {
        modalResolve = resolve;
        appModalInput.value = "";
        appModalTitle.textContent = title;
        appModalMessage.textContent = message;
        appModalConfirm.textContent = confirmLabel;
        appModalInputGroup.hidden = !input;
        appModal.hidden = false;
        requestAnimationFrame(() => appModal.classList.add("is-visible"));
        setTimeout(() => (input ? appModalInput : appModalConfirm).focus(), 80);
    });
}

appModalConfirm.addEventListener("click", () => {
    closeAppModal(appModalInputGroup.hidden ? true : appModalInput.value);
});
appModal.querySelectorAll("[data-modal-cancel]").forEach((element) => {
    element.addEventListener("click", () => closeAppModal(null));
});
appModalInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") appModalConfirm.click();
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalResolve) closeAppModal(null);
});

export { closeAppModal, openAppModal };
