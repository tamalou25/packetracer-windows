/**
 * Export du rapport d'audit en PDF : contenu validé (schéma zod), dialogue d'enregistrement
 * natif, page HTML imprimée par une fenêtre cachée sans script (printToPDF), puis écriture du
 * fichier choisi par l'utilisateur.
 */
import { app, BrowserWindow, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { auditReportFileName, parseAuditReport, renderAuditReportHtml } from '../shared/auditReport'
import type { FileResult } from '../shared/ipc'

const PDF_FILTERS = [{ name: 'Document PDF', extensions: ['pdf'] }]

/** Imprime la page HTML en PDF dans une fenêtre cachée, isolée et sans JavaScript. */
async function printHtml(html: string): Promise<Buffer> {
  // Fichier temporaire plutôt qu'une adresse data: (taille non bornée par la longueur d'URL)
  const dir = await fs.mkdtemp(join(tmpdir(), 'serverlab-rapport-'))
  const page = join(dir, 'rapport.html')
  const view = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
  })
  try {
    await fs.writeFile(page, html, 'utf8')
    await view.loadFile(page)
    return await view.webContents.printToPDF({ pageSize: 'A4', printBackground: true })
  } finally {
    view.destroy()
    await fs.rm(dir, { recursive: true, force: true })
  }
}

export async function exportAuditPdf(win: BrowserWindow, report: unknown): Promise<FileResult<string>> {
  const data = parseAuditReport(report)
  if (!data) return { ok: false, error: 'Paramètres invalides.' }
  const res = await dialog.showSaveDialog(win, {
    title: 'Exporter le rapport d’audit',
    defaultPath: join(app.getPath('documents'), auditReportFileName(data.lab)),
    filters: PDF_FILTERS
  })
  if (res.canceled || !res.filePath) return { ok: false, canceled: true }
  const path = extname(res.filePath).toLowerCase() === '.pdf' ? res.filePath : `${res.filePath}.pdf`
  try {
    await fs.writeFile(path, await printHtml(renderAuditReportHtml(data)))
    return { ok: true, value: path }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
