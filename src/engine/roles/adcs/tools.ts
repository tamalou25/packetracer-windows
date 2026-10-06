/**
 * certutil (sous-ensemble) : révocation, liste de révocation, magasins, inscription automatique.
 */
import type { ToolDef } from '../../shell/tools/types'
import { pulseAutoEnrollment, REVOCATION_REASONS, revokeCertificate } from './actions'
import { formatShortDate } from '../../core/clock'

const done = (verb: string) => `CertUtil: ${verb} La commande s’est terminée correctement.`

export const certutilTool: ToolDef = {
  name: 'certutil',
  synopsis: 'Gère les certificats et les services de certificats.',
  switches: ['-revoke', '-crl', '-pulse', '-store', '-?'],
  run(ctx, args) {
    const [verb = '', ...rest] = args
    const v = verb.toLowerCase().replace(/^\//, '-')
    const host = ctx.host
    if (v === '-revoke') {
      const serial = rest[0]
      const code = rest[1] === undefined ? 0 : Number(rest[1])
      const reason = REVOCATION_REASONS[code]
      if (!serial || reason === undefined) {
        ctx.writeLines(['Utilisation : certutil -revoke NuméroDeSérie [Motif]', '  Motif : 0 à 5'], 'error')
        return
      }
      const r = revokeCertificate(ctx.state, ctx.deviceId, serial, reason)
      if (!r.ok) {
        ctx.writeLines([r.error.message, `CertUtil: -revoke La commande a échoué.`], 'error')
        return
      }
      ctx.apply(r)
      ctx.writeLines([`Révocation du « ${serial} » -- Motif : ${reason}`, done('-revoke')])
      return
    }
    if (v === '-crl') {
      ctx.write(done('-crl'))
      return
    }
    if (v === '-pulse') {
      ctx.apply(pulseAutoEnrollment(ctx.state, ctx.deviceId))
      ctx.write(done('-pulse'))
      return
    }
    if (v === '-store') {
      const store = (rest[0] ?? 'My').toLowerCase() === 'root' ? 'Root' : 'My'
      const certs = host.host.certificates.filter((c) => c.store === store)
      ctx.write(
        `${store === 'My' ? 'My « Personnel »' : 'Root « Autorités de certification racines de confiance »'}`
      )
      certs.forEach((c, i) => {
        ctx.writeLines([
          `================ Certificat ${i} ================`,
          `Émetteur: ${c.issuer}`,
          ` NotBefore: ${formatShortDate(c.notBefore)}`,
          ` NotAfter: ${formatShortDate(c.notAfter)}`,
          `Objet: ${c.subject}`,
          `Hachage de cert(sha1): ${c.thumbprint.toLowerCase()}`
        ])
      })
      ctx.write(done('-store'))
      return
    }
    ctx.writeLines([
      'Utilisation :',
      '  certutil -revoke NuméroDeSérie [Motif]   Révoque un certificat',
      '  certutil -crl                            Publie la liste de révocation',
      '  certutil -pulse                          Déclenche l’inscription automatique',
      '  certutil -store [My|Root]                Affiche un magasin de certificats'
    ])
  }
}
