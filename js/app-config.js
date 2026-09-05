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

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", applyToPage, { once: true });
    } else {
        applyToPage();
    }
})(window.APP_CONFIG);
