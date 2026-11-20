// js/util.js — μικρές βοηθητικές συναρτήσεις χωρίς κατάσταση.

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
}

export { escapeHtml };
