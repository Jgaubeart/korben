const CACHE = "korben-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => "focus" in client);
      if (existing) return existing.focus();
      return self.clients.openWindow("/");
    })
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Korben", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "Korben", {
      body: payload.body || "Korben has an update.",
      icon: "/icon.svg",
      tag: payload.tag || "korben-update",
      data: payload.data || {},
    })
  );
});
