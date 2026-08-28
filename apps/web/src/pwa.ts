export function registerPwa(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL;
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloadedForUpdate = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloadedForUpdate) return;
      reloadedForUpdate = true;
      window.location.reload();
    });

    void navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base, updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch((error) => {
        console.error("Alpha 2 service worker registration failed", error);
      });
  });
}
