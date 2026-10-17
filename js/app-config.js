window.APP_CONFIG = {
    name: "Halalas University",
    shortName: "Halalas University",
    title: "Halalas University Portal",
    description: "Halalas University student portal",
    logo: "imgs/halalas-university-logo.png",
    favicon: "imgs/halalas-university-logo.png",
    themeColor: "#0f5c5c",
};

(function applyAppConfig(config) {
    document.title = config.title;

    const setMeta = (name, content) => {
        let meta = document.querySelector(`meta[name="${name}"]`);
        if (!meta) {
            meta = document.createElement("meta");
            meta.name = name;
            document.head.appendChild(meta);
        }
        meta.content = content;
    };

    setMeta("application-name", config.name);
    setMeta("apple-mobile-web-app-title", config.shortName);
    setMeta("theme-color", config.themeColor);
    setMeta("description", config.description);

    let icon = document.querySelector('link[rel="icon"]');
    if (!icon) {
        icon = document.createElement("link");
        icon.rel = "icon";
        document.head.appendChild(icon);
    }
    icon.href = config.favicon;

    const applyToPage = () => {
        document.querySelectorAll("[data-app-name]").forEach((element) => {
            element.textContent = config.name;
        });
        document.querySelectorAll("[data-app-title]").forEach((element) => {
            element.textContent = config.title;
        });
        document.querySelectorAll("[data-app-logo]").forEach((element) => {
            element.src = config.logo;
            element.alt = config.title;
        });
    };

    // Δίχτυ ασφαλείας για το πάνω inset. Αν το iOS τρέχει την εφαρμογή από
    // την αρχική οθόνη αλλά το env(safe-area-inset-top) βγαίνει 0, η σελίδα
    // ζωγραφίζεται κάτω από την ώρα και τίποτα δεν την κατεβάζει. Μετράμε το
    // πραγματικό env() και, μόνο αν είναι 0 εκεί που δεν θα έπρεπε, βάζουμε
    // στο --safe-top το ύψος της status bar για το συγκεκριμένο μέγεθος
    // οθόνης. Όταν το env() δουλεύει, αυτό δεν αγγίζει τίποτα.
    const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isStandalone = navigator.standalone === true
        || window.matchMedia("(display-mode: standalone)").matches;

    const fixSafeTop = () => {
        const root = document.documentElement;
        root.style.removeProperty("--safe-top");
        if (!isIos || !isStandalone) return;
        // Στο οριζόντιο δεν υπάρχει status bar· εκεί το 0 είναι σωστό.
        if (!window.matchMedia("(orientation: portrait)").matches) return;

        const probe = document.createElement("div");
        probe.style.cssText = "position:fixed;top:0;visibility:hidden;padding-top:env(safe-area-inset-top,0px)";
        document.body.appendChild(probe);
        const measured = parseFloat(getComputedStyle(probe).paddingTop) || 0;
        probe.remove();
        if (measured > 0) return;

        // Dynamic Island (από iPhone 14 Pro): ~59pt. Εγκοπή: ~47pt.
        // Παλιά iPhone με κουμπί Home: 20pt.
        const tall = Math.max(screen.width, screen.height);
        const fallback = tall >= 852 ? 59 : tall >= 812 ? 47 : 20;
        root.style.setProperty("--safe-top", `${fallback}px`);
    };

    const onReady = () => {
        fixSafeTop();
        window.addEventListener("orientationchange", () => setTimeout(fixSafeTop, 300));
    };
    if (document.body) onReady();
    else document.addEventListener("DOMContentLoaded", onReady, { once: true });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", applyToPage, { once: true });
    } else {
        applyToPage();
    }
})(window.APP_CONFIG);
