// Το άνοιγμα της εφαρμογής ρωτάει πάντα το δίκτυο για τη σελίδα: το GitHub
// Pages την κρατάει 10' στην cache, οπότε χωρίς αυτό ένα deploy φαινόταν
// αργότερα. Μία γρήγορη ερώτηση (συνήθως 304). Χωρίς δίκτυο, ό,τι θα έκανε ο
// browser χωρίς εμάς: η σελίδα από την cache του όσο είναι ακόμα φρέσκια, αλλιώς
// η δική του σελίδα «χωρίς σύνδεση» — όχι μια παλιά σελίδα με css/js που έχουν
// λήξει. Κανένα άλλο αίτημα δεν περνάει από εδώ, και δεν κρατάμε δική μας cache.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
    if (event.request.mode !== "navigate") return;
    // Με το URL, όχι με το ίδιο το request: ένα request πλοήγησης δεν δέχεται
    // άλλες ρυθμίσεις cache (TypeError). Τα redirects τα αφήνουμε στον browser
    // ("manual"): μια πλοήγηση δεν δέχεται απάντηση που ακολούθησε ήδη redirect.
    const url = event.request.url;
    event.respondWith(
        fetch(url, { cache: "no-cache", redirect: "manual" }).catch(() => fetch(url, { redirect: "manual" })),
    );
});

self.addEventListener("push", (event) => {
    const data = event.data ? event.data.json() : {};
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
        }),
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if ("focus" in client) return client.focus();
            }
            return clients.openWindow("/");
        }),
    );
});