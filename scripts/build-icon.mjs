// Génère build/icon.png (512×512) à partir de build/icon.svg.
// electron-builder convertit ce PNG en .ico (Windows) et l'utilise pour l'AppImage (Linux).
import { readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const svg = readFileSync(new URL('../build/icon.svg', import.meta.url))
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng()
writeFileSync(new URL('../build/icon.png', import.meta.url), png)
console.log('build/icon.png généré (512×512)')
