// Pasta digitada pelo usuario: sem espacos nas pontas e sem as aspas do "Copiar como caminho" do Explorer.
export const cleanPath = (p: string): string => p.trim().replace(/^"(.*)"$/, '$1').trim()

// Caminho completo (C:\..., \\servidor\..., /...). Relativo seria resolvido contra a pasta do proprio Turno.
export const isAbsPath = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || /^\\\\[^\\]/.test(p) || p.startsWith('/')

// Pasta existe e e um caminho completo (relativo conta como "nao existe")
export const folderOk = async (p: string): Promise<boolean> => isAbsPath(p) && (await window.turno.ui.pathExists(p))
