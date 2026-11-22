/**
 * What may be said about a failed file operation in the log or on screen: the error code and the system call, never
 * the raw message (it holds absolute paths, and with them the name of the operating system user).
 */
export const errCode = (err: unknown): string => {
  const e = err as NodeJS.ErrnoException
  return e?.code ?? (err instanceof Error ? err.name : 'unknown')
}

export const fsErrorText = (err: unknown): string => {
  const syscall = (err as NodeJS.ErrnoException | undefined)?.syscall
  return `${errCode(err)}${syscall ? `, ${syscall}` : ''}`
}
