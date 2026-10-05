/**
 * Corbeille (vide : aucun fichier n'est supprimé dans le système simulé).
 */
import { ArrowLeft, ArrowRight, ArrowUp, Trash2 } from 'lucide-react'

export function RecycleBin() {
  return (
    <div className="flex h-full flex-col bg-white text-xs text-black">
      <div className="flex items-center gap-1 border-b border-[#e5e5e5] px-2 py-1.5 text-[#6d6d6d]">
        <ArrowLeft size={14} />
        <ArrowRight size={14} />
        <ArrowUp size={14} />
        <div className="ml-2 flex flex-1 items-center gap-1 border border-[#d9d9d9] px-2 py-0.5 text-black">
          <Trash2 size={13} className="text-slate-500" /> › Corbeille
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center text-[#6d6d6d]">Ce dossier est vide.</div>
      <div className="border-t border-[#f0f0f0] px-2 py-0.5 text-[11px] text-[#6d6d6d]">0 élément</div>
    </div>
  )
}
