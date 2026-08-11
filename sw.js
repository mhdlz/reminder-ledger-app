// Android Background Service Worker
self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    return self.clients.claim();
});

self.addEventListener('push', (e) => {
    const data = e.data ? e.data.text() : '⏰ রিমাইন্ডার সময় হয়েছে!';
    self.registration.showNotification('রিমাইন্ডার এলার্ম!', {
        body: data,
        vibrate: [1000, 500, 1000, 500, 1000]
    });
});