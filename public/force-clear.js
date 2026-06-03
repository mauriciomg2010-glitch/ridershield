(async () => {
  const FLAG = 'zivo-cleared-v3';
  if (localStorage.getItem(FLAG)) return;
  localStorage.setItem(FLAG, '1');

  console.log('[ZIVO] Limpeza agressiva iniciada...');

  // 1. Desregistrar todos os Service Workers
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    console.log('[ZIVO] SWs encontrados:', regs.length);
    for (const reg of regs) {
      await reg.unregister();
      console.log('[ZIVO] SW desregistrado:', reg.scope);
    }
  }

  // 2. Limpar TODOS os caches da Cache API
  if ('caches' in window) {
    const names = await caches.keys();
    console.log('[ZIVO] Caches encontrados:', names);
    for (const name of names) {
      await caches.delete(name);
      console.log('[ZIVO] Cache deletado:', name);
    }
  }

  // 3. Limpar IndexedDB (onde disponível)
  if ('indexedDB' in window && typeof indexedDB.databases === 'function') {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) {
        indexedDB.deleteDatabase(db.name);
        console.log('[ZIVO] IndexedDB deletado:', db.name);
      }
    }
  }

  console.log('[ZIVO] Limpeza completa! Reload em 1.5s...');
  setTimeout(() => {
    window.location.href = '/admin?' + Date.now();
  }, 1500);
})();
