// tests/names.mjs — node tests/names.mjs
// Ένα όνομα που έμεινε σε άλλο module μετά τον χωρισμό δίνει ReferenceError
// μόνο όταν τρέξει εκείνη η γραμμή — συχνά σε μονοπάτι σφάλματος που κανένα
// browser test δεν περνάει. Το eslint (no-undef, no-import-assign) το βρίσκει
// χωρίς να τρέξει τίποτα. Εργαλείο ελέγχου, όπως το playwright: δεν μπαίνει
// στο repo.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = fs.readdirSync(path.join(root, "js"))
    .filter((f) => f.endsWith(".js") && f !== "app-config.js")
    .map((f) => path.join("js", f));

// Τα globals του browser που χρησιμοποιεί πραγματικά ο κώδικας.
const GLOBALS = [
    "window", "document", "navigator", "location", "localStorage", "sessionStorage",
    "fetch", "Response", "URL", "URLSearchParams", "Notification", "PushManager", "Intl", "console",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame",
    "cancelAnimationFrame", "getComputedStyle", "matchMedia", "atob", "btoa", "Blob",
    "AbortController", "IntersectionObserver", "ResizeObserver", "performance", "structuredClone",
    "HTMLElement", "Event", "CustomEvent", "CSS", "$",
];

const eslint = (sourceType, globals, targets) => spawnSync("npx", [
    "--yes", "eslint@9.15.0",
    "--no-config-lookup",
    "--rule", "no-undef: error",
    // Ένα import δεν παίρνει νέα τιμή (TypeError όταν τρέξει η γραμμή).
    "--rule", "no-import-assign: error",
    "--parser-options", `sourceType:${sourceType}`,
    "--parser-options", "ecmaVersion:latest",
    "--global", globals.join(","),
    ...targets,
], { cwd: root, stdio: "inherit" }).status;

// Ο service worker είναι κλασικό script σε άλλο περιβάλλον: self, clients.
const SW_GLOBALS = ["self", "clients", "fetch", "console"];
const app = eslint("module", GLOBALS, files);
const sw = eslint("script", SW_GLOBALS, ["sw.js"]);
process.exit(app === 0 && sw === 0 ? 0 : 1);
