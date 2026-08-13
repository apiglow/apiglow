// IndexedDB plumbing shared by the app's three databases (history,
// scenarios, schema snapshot). Nothing business-specific here: opening, and transacting
// on a single store — the only pattern the app needs.
//
// Extracted because the three copies were starting to diverge: any fix
// (transaction rejection, database unavailable in private browsing) must apply
// to all three.

export function openDatabase(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => upgrade(request.result, request.transaction)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// `fn(store)` issues its requests; the promise follows the TRANSACTION, not the
// individual requests — it's the transaction that guarantees everything was written, and its
// abort (quota, closed database) must reject.
export function runTransaction(dbPromise, storeName, mode, fn) {
  return dbPromise.then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        fn(tx.objectStore(storeName))
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}
