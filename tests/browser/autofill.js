// Οι αποθηκευμένοι κωδικοί του κινητού (Keychain στο iPhone) γράφουν το όνομα
// χρήστη στο πεδίο κειμένου ακριβώς πριν από ένα πεδίο κωδικού. Το παράθυρο
// κωδικού δεν είχε δικό του, οπότε το iPhone έγραφε το csd… στην αναζήτηση των
// Αρχείων κάθε φορά (2026-11-28). Κάθε πεδίο κωδικού πρέπει να έχει πριν από
// αυτό ένα πεδίο ονόματος χρήστη· κανένα πεδίο αναζήτησης δεν πρέπει να είναι
// αυτό.
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const SITE = process.argv[2];

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.route(/uni-api\.halalas-services\.xyz/, (r) => r.fulfill({ status: 401, json: { ok: false, code: "NO_SESSION" } }));
    await page.goto(SITE);
    const pairs = await page.evaluate(() => {
        const fields = [...document.querySelectorAll("input")].filter((i) => !["checkbox", "radio", "hidden", "button", "submit"].includes(i.type));
        return fields
            .map((input, index) => ({ input, index }))
            .filter(({ input }) => input.type === "password")
            .map(({ input, index }) => {
                const before = fields.slice(0, index).reverse().find((f) => f.type !== "password");
                return {
                    password: input.id,
                    before: before ? { id: before.id, type: before.type, autocomplete: before.getAttribute("autocomplete") } : null,
                };
            });
    });
    const results = [];
    for (const { password, before } of pairs) {
        try {
            assert.ok(before, "no field before it");
            assert.notEqual(before.type, "search", `${before.id} is a search field`);
            assert.equal(before.autocomplete, "username", `${before.id} is not a username field`);
            results.push(`PASS  ${password}: the field before it is a username field (${before.id})`);
        } catch (e) {
            results.push(`FAIL  ${password}: ${e.message.split("\n")[0]}`);
        }
    }
    if (pairs.length < 2) results.push(`FAIL  expected at least two password fields, found ${pairs.length}`);
    await browser.close();
    console.log(results.join("\n"));
    if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})();
