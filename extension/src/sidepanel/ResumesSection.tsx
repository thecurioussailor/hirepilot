import { useEffect, useRef, useState } from 'react';
import { IMPORT_SECTIONS, planImport, type ImportSection, type Profile, type ResumeMeta } from '@hirepilot/shared';
import {
  deleteResume,
  extractProfileFromResume,
  fetchResumeFile,
  listResumes,
  renameResume,
  setDefaultResume,
  uploadResume,
} from '../lib/api';
import type { Settings } from '../lib/settings';

const smallBtn =
  'rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800';
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

const SECTION_LABELS: Record<ImportSection, string> = {
  basics: 'Basics',
  links: 'Links',
  skills: 'New skills',
  experience: 'Experience',
  education: 'Education',
  projects: 'Projects',
};

/** Shows what a resume would add to the profile; user picks sections, then applies. */
function ImportReview({ resume, current, proposed, onApply, onCancel }: {
  resume: ResumeMeta;
  current: Profile;
  proposed: Profile;
  onApply: (sections: ImportSection[]) => void;
  onCancel: () => void;
}) {
  const plan = planImport(current, proposed);
  const [picked, setPicked] = useState<Set<ImportSection>>(() => new Set(plan.map((p) => p.section)));

  if (plan.length === 0) {
    return (
      <div className="space-y-2 rounded border border-indigo-300 p-2 text-xs dark:border-indigo-800">
        <p>Nothing new in “{resume.label}”: your profile already has everything it found.</p>
        <button className={smallBtn} onClick={onCancel}>Close</button>
      </div>
    );
  }

  const toggle = (s: ImportSection) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  return (
    <div className="space-y-2 rounded border border-indigo-300 p-2 text-xs dark:border-indigo-800">
      <p className="font-medium">Review what HirePilot found in “{resume.label}”</p>
      <p className="text-slate-500">
        Only empty fields get filled and only new items get added. Nothing you already have is changed. Check it matches
        your resume before applying.
      </p>
      {plan.map((p) => (
        <label key={p.section} className="block rounded bg-slate-50 p-2 dark:bg-slate-900">
          <span className="flex items-center gap-1.5 font-medium">
            <input type="checkbox" checked={picked.has(p.section)} onChange={() => toggle(p.section)} />
            {SECTION_LABELS[p.section]}
          </span>
          <ul className="mt-1 list-disc space-y-0.5 pl-6 text-slate-600 dark:text-slate-400">
            {p.changes.map((c, i) => (
              <li key={i} className="break-words">{c}</li>
            ))}
          </ul>
        </label>
      ))}
      <div className="flex gap-2">
        <button
          className="rounded bg-indigo-600 px-2 py-1 text-white disabled:opacity-50"
          disabled={picked.size === 0}
          onClick={() => onApply(IMPORT_SECTIONS.filter((s) => picked.has(s)))}
        >
          Add to profile
        </button>
        <button className={smallBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function ResumesSection({ settings, getProfile, onApplyImport }: {
  settings: Settings;
  /** Latest profile (including unsaved edits) to compare against. */
  getProfile: () => Profile;
  /** Merge the chosen sections into the profile and save it. */
  onApplyImport: (proposed: Profile, sections: ImportSection[]) => Promise<void>;
}) {
  const [resumes, setResumes] = useState<ResumeMeta[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // resume id or 'upload'
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [review, setReview] = useState<{ resume: ResumeMeta; proposed: Profile } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => listResumes(settings).then(setResumes).catch((e) => setMessage({ kind: 'error', text: errText(e) }));
  useEffect(() => {
    void refresh();
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ kind: 'error', text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void run('upload', async () => {
      const { resume, warning } = await uploadResume(settings, file);
      await refresh();
      setMessage(
        warning
          ? { kind: 'warn', text: warning }
          : { kind: 'ok', text: `Uploaded “${resume.label}”${resume.isDefault ? ' (default)' : ''}.` },
      );
    });
    if (fileInput.current) fileInput.current.value = '';
  };

  const open = (r: ResumeMeta) =>
    run(r.id, async () => {
      const url = URL.createObjectURL(await fetchResumeFile(settings, r.id));
      // tabs.create (not window.open): no popup blocker after the await.
      await chrome.tabs.create({ url });
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });

  const importFrom = (r: ResumeMeta) =>
    run(r.id, async () => {
      setMessage({ kind: 'ok', text: `Reading “${r.label}”… (this takes a few seconds)` });
      const proposed = await extractProfileFromResume(settings, r.id);
      setMessage(null);
      setReview({ resume: r, proposed });
    });

  const remove = (r: ResumeMeta) =>
    run(r.id, async () => {
      if (!window.confirm(`Delete “${r.label}”? The PDF is removed from your computer's HirePilot data.`)) return;
      await deleteResume(settings, r.id);
      await refresh();
    });

  const saveRename = () =>
    renaming &&
    run(renaming.id, async () => {
      await renameResume(settings, renaming.id, renaming.label.trim() || 'Resume');
      setRenaming(null);
      await refresh();
    });

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Your default resume is what HirePilot reads to answer questions about you, and (soon) what it attaches to
        applications. PDF only, up to 5 MB.
      </p>

      {resumes?.length === 0 && <p className="text-xs text-slate-500">No resumes yet.</p>}

      {resumes?.map((r) => (
        <div key={r.id} className="space-y-1 rounded bg-slate-50 p-2 text-sm dark:bg-slate-900">
          <div className="flex items-center gap-2">
            {renaming?.id === r.id ? (
              <input
                className="flex-1 rounded border border-slate-300 bg-transparent px-1 text-sm dark:border-slate-700"
                value={renaming.label}
                autoFocus
                onChange={(e) => setRenaming({ id: r.id, label: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveRename();
                  if (e.key === 'Escape') setRenaming(null);
                }}
                onBlur={() => void saveRename()}
              />
            ) : (
              <button className="flex-1 truncate text-left font-medium" title="Click to rename" onClick={() => setRenaming({ id: r.id, label: r.label })}>
                {r.label}
              </button>
            )}
            {r.isDefault && <span className="rounded bg-emerald-100 px-1.5 text-[10px] uppercase text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">default</span>}
          </div>
          <p className="text-[11px] text-slate-500">
            {r.fileName} · {kb(r.sizeBytes)} · {r.textChars < 200 ? 'no readable text' : `${r.textChars.toLocaleString()} chars of text`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {!r.isDefault && (
              <button className={smallBtn} disabled={!!busy} onClick={() => void run(r.id, async () => { await setDefaultResume(settings, r.id); await refresh(); })}>
                Make default
              </button>
            )}
            <button className={smallBtn} disabled={!!busy} onClick={() => void open(r)}>Open</button>
            <button className={smallBtn} disabled={!!busy || r.textChars < 200} onClick={() => void importFrom(r)}>
              {busy === r.id ? 'Working…' : 'Fill profile from this'}
            </button>
            <button className={`${smallBtn} text-red-600`} disabled={!!busy} onClick={() => void remove(r)}>Delete</button>
          </div>
        </div>
      ))}

      {review && (
        <ImportReview
          resume={review.resume}
          current={getProfile()}
          proposed={review.proposed}
          onCancel={() => setReview(null)}
          onApply={(sections) =>
            void run(review.resume.id, async () => {
              await onApplyImport(review.proposed, sections);
              setReview(null);
              setMessage({ kind: 'ok', text: 'Added to your profile and saved. Review the sections below.' });
            })
          }
        />
      )}

      <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <button className={smallBtn} disabled={!!busy} onClick={() => fileInput.current?.click()}>
        {busy === 'upload' ? 'Uploading…' : '+ Upload resume (PDF)'}
      </button>

      {message && (
        <p className={`text-xs ${message.kind === 'error' ? 'text-red-600' : message.kind === 'warn' ? 'text-amber-600' : 'text-emerald-600'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
