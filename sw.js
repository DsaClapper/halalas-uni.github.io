// Το άνοιγμα της εφαρμογής ρωτάει πάντα το δίκτυο για τη σελίδα: το GitHub
// Pages την κρατάει 10' στην cache, οπότε χωρίς αυτό ένα deploy φαινόταν
// αργότερα. Μία γρήγορη ερώτηση (συνήθως 304). Χωρίς δίκτυο, ό,τι έχει ο
// browser, όσο παλιό κι αν είναι. Κανένα άλλο αίτημα δεν περνάει από εδώ, και
// δεν κρατάμε δική μας cache.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
    if (event.request.mode !== "navigate") return;
    // Με το URL, όχι με το ίδιο το request: ένα request πλοήγησης δεν δέχεται
    // άλλες ρυθμίσεις cache (TypeError).
    const url = event.request.url;
    event.respondWith(fetch(url, { cache: "no-cache" }).catch(() => fetch(url, { cache: "force-cache" })));
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