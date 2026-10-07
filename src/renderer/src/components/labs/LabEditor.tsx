/**
 * Éditeur de labs : énoncé Markdown avec aperçu, topologie de départ capturée sur le lab courant,
 * critères construits sans code (type, champs avec suggestions, indices à plusieurs niveaux),
 * testés immédiatement sur le lab courant ; export / import JSON et essai du lab.
 */
import { useMemo, useState } from 'react'
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Download,
  FlaskConical,
  Play,
  Plus,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { criterionCatalog, criterionTypeInfo, labReferences, type CriterionField } from '@engine/index'
import {
  addCriterion,
  captureStart,
  criterionError,
  exportDraft,
  importIntoEditor,
  removeCriterion,
  setCriterionType,
  setCriterionValue,
  testCriteria,
  tryDraft
} from '../../lib/labEditor'
import { useLabEditorStore, type DraftCriterion } from '../../store/labEditor'
import { useLabStore } from '../../store/lab'
import { Button, Field, inputClass } from '../common/ui'
import { Markdown } from './Markdown'

const DIFFICULTIES = ['Débutant', 'Intermédiaire', 'Avancé'] as const

export function LabEditor() {
  const open = useLabEditorStore((s) => s.open)
  const draft = useLabEditorStore((s) => s.draft)
  const start = useLabEditorStore((s) => s.start)
  const lab = useLabStore((s) => s.lab)
  const references = useMemo(() => labReferences(lab), [lab])
  const [preview, setPreview] = useState(false)
  const [newType, setNewType] = useState('featureInstalled')
  if (!open) return null
  const update = useLabEditorStore.getState().update
  const startCount = start ? Object.keys(start.devices).length : 0
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-scrim"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex h-[90vh] w-[1040px] max-w-[96vw] flex-col rounded-md border border-line bg-overlay shadow-lg"
        data-testid="lab-editor"
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <FlaskConical size={18} className="text-accent" />
          <h2 className="text-base font-semibold text-fg">Éditeur de labs</h2>
          <button
            type="button"
            onClick={() => useLabEditorStore.getState().setOpen(false)}
            className="ml-auto rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
            aria-label="Fermer"
            data-testid="editor-close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[380px_1fr]">
          {/* Description du lab */}
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-line p-4">
            <Field label="Titre">
              <input
                className={inputClass}
                value={draft.title}
                onChange={(e) => update({ title: e.target.value })}
                data-testid="editor-title"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Difficulté">
                <select
                  className={inputClass}
                  value={draft.difficulty}
                  onChange={(e) => update({ difficulty: e.target.value as (typeof DIFFICULTIES)[number] })}
                  data-testid="editor-difficulty"
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </Field>
              <Field label="Durée indicative">
                <input
                  className={inputClass}
                  value={draft.duration}
                  onChange={(e) => update({ duration: e.target.value })}
                  data-testid="editor-duration"
                />
              </Field>
            </div>
            <Field label="Résumé">
              <input
                className={inputClass}
                value={draft.summary}
                onChange={(e) => update({ summary: e.target.value })}
                data-testid="editor-summary"
              />
            </Field>
            <div className="flex min-h-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                <span>Énoncé (Markdown)</span>
                <button
                  type="button"
                  onClick={() => setPreview(!preview)}
                  className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent-soft"
                  data-testid="editor-preview-toggle"
                >
                  {preview ? 'Modifier' : 'Aperçu'}
                </button>
              </div>
              {preview ? (
                <div
                  className="min-h-48 flex-1 overflow-y-auto rounded-md border border-line bg-surface p-3"
                  data-testid="editor-preview"
                >
                  <Markdown text={draft.statement} />
                </div>
              ) : (
                <textarea
                  className={`${inputClass} min-h-48 flex-1 resize-none py-1.5 font-mono text-[12px]`}
                  value={draft.statement}
                  placeholder={'## Contexte\n\nDécrivez la situation et les tâches à réaliser.'}
                  onChange={(e) => update({ statement: e.target.value })}
                  data-testid="editor-statement"
                />
              )}
            </div>
            <div className="rounded-md border border-line bg-surface p-2 text-[12px] text-fg-muted">
              <div className="mb-1 font-medium text-fg" data-testid="editor-start-info">
                Topologie de départ : {start ? `${startCount} équipement(s)` : 'non capturée'}
              </div>
              <p className="mb-2">
                Le départ est l’état du lab au moment de la capture. Réalisez ensuite la solution dans le lab
                pour tester les critères.
              </p>
              <Button onClick={captureStart} data-testid="editor-capture">
                Capturer le lab courant
              </Button>
            </div>
          </div>
          {/* Critères */}
          <div className="flex min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2">
              <span className="text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
                Critères ({draft.criteria.length})
              </span>
              <select
                className={`${inputClass} ml-auto !w-72`}
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                data-testid="editor-new-type"
              >
                {criterionCatalog().map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.label}
                  </option>
                ))}
              </select>
              <Button onClick={() => addCriterion(newType)} data-testid="editor-add-criterion">
                <Plus size={14} /> Ajouter
              </Button>
              <Button onClick={() => testCriteria()} data-testid="editor-test-all">
                Tester tout
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {draft.criteria.length === 0 ? (
                <p className="text-[13px] text-fg-muted">
                  Ajoutez un critère : choisissez ce qui doit être vérifié, puis les équipements ou objets
                  concernés. Chaque critère se teste aussitôt sur le lab courant.
                </p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {draft.criteria.map((c, i) => (
                    <CriterionCard key={c.key} index={i} criterion={c} references={references} />
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <Button onClick={() => void importIntoEditor()} data-testid="editor-import">
            <Upload size={14} /> Importer…
          </Button>
          <Button onClick={() => void exportDraft()} data-testid="editor-export">
            <Download size={14} /> Exporter…
          </Button>
          <Button
            variant="primary"
            className="ml-auto"
            onClick={() => void tryDraft()}
            data-testid="editor-try"
          >
            <Play size={14} /> Essayer le lab
          </Button>
        </div>
      </div>
    </div>
  )
}

function CriterionCard({
  index,
  criterion,
  references
}: {
  index: number
  criterion: DraftCriterion
  references: ReturnType<typeof labReferences>
}) {
  const info = criterionTypeInfo(criterion.type)
  const set = (patch: Partial<DraftCriterion>) =>
    useLabEditorStore.getState().setCriterion(criterion.key, patch)
  const error = criterionError(criterion)
  return (
    <li className="rounded-md border border-line bg-surface p-3" data-testid={`editor-criterion-${index}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[12px] text-fg-subtle">{index + 1}</span>
        <select
          className={`${inputClass} !w-72`}
          value={criterion.type}
          onChange={(e) => setCriterionType(criterion.key, e.target.value)}
          data-testid="editor-type"
        >
          {criterionCatalog().map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        <span
          className="ml-auto flex items-center gap-1 text-[12px]"
          data-testid="editor-result"
          data-state={criterion.tested === null ? 'pending' : criterion.tested ? 'ok' : 'ko'}
        >
          {criterion.tested === null ? (
            <CircleDashed size={15} className="text-fg-subtle" />
          ) : criterion.tested ? (
            <>
              <CircleCheck size={15} className="text-ok" /> <span className="text-ok">Validé</span>
            </>
          ) : (
            <>
              <CircleX size={15} className="text-danger" /> <span className="text-danger">Non validé</span>
            </>
          )}
        </span>
        <Button
          onClick={() => testCriteria(criterion.key)}
          disabled={!criterion.check}
          title="Tester sur le lab courant"
          data-testid="editor-test"
        >
          Tester
        </Button>
        <Button
          variant="ghostDanger"
          onClick={() => removeCriterion(criterion.key)}
          title="Supprimer le critère"
          aria-label="Supprimer le critère"
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <Field label="Ce qui est attendu (visible par l’étudiant)">
        <input
          className={inputClass}
          value={criterion.label}
          onChange={(e) => set({ label: e.target.value })}
          data-testid="editor-label"
        />
      </Field>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {info?.fields.map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            value={criterion.values[f.key]}
            suggestions={f.reference ? references[f.reference] : []}
            onChange={(v) => setCriterionValue(criterion.key, f.key, v)}
          />
        ))}
      </div>
      {error && (
        <p className="mt-1 text-[11px] text-warn" data-testid="editor-error">
          {error}
        </p>
      )}
      <div className="mt-2 flex flex-col gap-1">
        {criterion.hints.map((hint, n) => (
          <Field key={n} label={`Indice ${n + 1}${n === 0 ? ' (après un échec)' : ' (sur demande)'}`}>
            <input
              className={inputClass}
              value={hint}
              onChange={(e) => set({ hints: criterion.hints.map((h, k) => (k === n ? e.target.value : h)) })}
              data-testid={`editor-hint-${n}`}
            />
          </Field>
        ))}
        <button
          type="button"
          onClick={() => set({ hints: [...criterion.hints, ''] })}
          className="self-start text-[11px] text-accent hover:underline"
          data-testid="editor-add-hint"
        >
          + Indice plus précis
        </button>
      </div>
    </li>
  )
}

function FieldInput({
  field,
  value,
  suggestions,
  onChange
}: {
  field: CriterionField
  value: string | boolean | string[] | undefined
  suggestions: string[]
  onChange: (value: string | boolean | string[]) => void
}) {
  const label = `${field.label}${field.optional ? ' (facultatif)' : ''}`
  const testId = `editor-field-${field.key}`
  if (field.kind === 'boolean') {
    const current = value === undefined ? '' : String(value)
    return (
      <Field label={label}>
        <select
          className={inputClass}
          value={current}
          onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value === 'true')}
          data-testid={testId}
        >
          {field.optional && (
            <option value="">
              {field.defaultValue === undefined ? '—' : `Par défaut (${field.defaultValue ? 'oui' : 'non'})`}
            </option>
          )}
          <option value="true">Oui</option>
          <option value="false">Non</option>
        </select>
      </Field>
    )
  }
  if (field.kind === 'enum')
    return (
      <Field label={label}>
        <select
          className={inputClass}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
        >
          <option value="">{field.optional ? '—' : 'Choisir…'}</option>
          {field.options?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </Field>
    )
  if (field.kind === 'enumList') {
    const selected = Array.isArray(value) ? value : []
    return (
      <Field label={label}>
        <div className="flex flex-wrap gap-x-3 gap-y-1" data-testid={testId}>
          {field.options?.map((o) => (
            <label key={o} className="flex items-center gap-1 text-[12px] text-fg">
              <input
                type="checkbox"
                checked={selected.includes(o)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, o] : selected.filter((s) => s !== o))
                }
              />
              {o}
            </label>
          ))}
        </div>
      </Field>
    )
  }
  const listId = suggestions.length > 0 ? `${testId}-suggestions` : undefined
  return (
    <Field label={field.kind === 'list' ? `${label} — séparés par des virgules` : label}>
      <input
        className={inputClass}
        type={field.kind === 'number' ? 'number' : 'text'}
        value={Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : ''}
        list={listId}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </Field>
  )
}
