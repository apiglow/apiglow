// A cap being reached is not a broken database: the user can act on it
// (export, delete). The UI must distinguish the two, hence a dedicated type
// rather than a message the caller would have to parse.
export class StorageLimitError extends Error {
  constructor(limit) {
    super(`storage limit reached (${limit})`)
    this.name = 'StorageLimitError'
    this.limit = limit
  }
}
