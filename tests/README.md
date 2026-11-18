# Tests

Χωρίς κανένα πακέτο στο repo· χρειάζεται μόνο Node 22 και `playwright@1.48.2`
κάπου στο `NODE_PATH` (στο CI και τοπικά τρέχουν μέσα στο
`mcr.microsoft.com/playwright:v1.48.2-noble`).

- `node tests/run.mjs` — όλα τα browser tests (`tests/browser/*.js`), με τη
  σελίδα σερβιρισμένη από το `tests/serve.mjs` όπως από το GitHub Pages
  (cache headers, Last-Modified, 304). `node tests/run.mjs login files` για λίγα.
- Το API είναι πάντα mocked με `page.route`: κανένα test δεν χτυπάει τον server
  και όλα τα δεδομένα είναι ψεύτικα.
- Screenshots πηγαίνουν στο `tests/out/` (εκτός git).
