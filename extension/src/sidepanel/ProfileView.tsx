import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  applyImport,
  MEMORY_CATEGORIES,
  type ImportSection,
  WORK_MODES,
  type Education,
  type Experience,
  type MemoryCategory,
  type MemoryFact,
  type Profile,
  type Project,
} from '@hirepilot/shared';
import { addFact, deleteFact, exportData, getProfile, saveProfile, updateFact } from '../lib/api';
import type { Settings } from '../lib/settings';
import { ResumesSection } from './ResumesSection';

const inputCls =
  'w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500';
const smallBtn = 'rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800';
const newId = () => crypto.randomUUID();
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ---------- small building blocks ---------- */

function Field({ label, value, onChange, multiline, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-slate-500">{label}</span>
      {multiline ? (
        <textarea className={inputCls} rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

/**
 * Edits a string[] as text. Keeps the raw text while typing (so "Rust, " doesn't
 * get eaten) and only splits when you leave the field.
 */
function ListField({ label, value, onChange, separator = 'comma', placeholder }: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  separator?: 'comma' | 'line';
  placeholder?: string;
}) {
  const join = (v: string[]) => v.join(separator === 'comma' ? ', ' : '\n');
  const [raw, setRaw] = useState(join(value));
  useEffect(() => setRaw(join(value)), [value.join('\u0000')]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => onChange(raw.split(separator === 'comma' ? /[,\n]/ : /\n/).map((s) => s.trim()).filter(Boolean));
  return (
    <label className="block space-y-1">
      <span className="text-xs text-slate-500">{label}</span>
      {separator === 'line' ? (
        <textarea className={inputCls} rows={3} value={raw} placeholder={placeholder} onChange={(e) => setRaw(e.target.value)} onBlur={commit} />
      ) : (
        <input className={inputCls} value={raw} placeholder={placeholder} onChange={(e) => setRaw(e.target.value)} onBlur={commit} />
      )}
    </label>
  );
}

function Section({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded border border-slate-200 dark:border-slate-800">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">{title}</summary>
      <div className="space-y-3 px-3 pb-3">{children}</div>
    </details>
  );
}

/** Generic editor for experience / education / projects lists. */
function ItemList<T extends { id: string }>({ items, onChange, blank, title, render }: {
  items: T[];
  onChange: (items: T[]) => void;
  blank: () => T;
  title: (item: T) => string;
  render: (item: T, update: (patch: Partial<T>) => void) => ReactNode;
}) {
  const update = (id: string, patch: Partial<T>) => onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <details key={item.id} className="rounded bg-slate-50 dark:bg-slate-900" open={!title(item)}>
          <summary className="flex cursor-pointer items-center justify-between px-2 py-1.5 text-sm">
            <span className="truncate">{title(item) || 'New entry'}</span>
            <button
              className="text-xs text-red-600 hover:underline"
              onClick={(e) => {
                e.preventDefault();
                onChange(items.filter((it) => it.id !== item.id));
              }}
            >
              Remove
            </button>
          </summary>
          <div className="space-y-2 px-2 pb-2">{render(item, (patch) => update(item.id, patch))}</div>
        </details>
      ))}
      <button className={smallBtn} onClick={() => onChange([...items, blank()])}>
        + Add
      </button>
    </div>
  );
}

/* ---------- memory (saved notes) ---------- */

function MemoryList({ settings, facts, setFacts, onError }: {
  settings: Settings;
  facts: MemoryFact[];
  setFacts: (f: MemoryFact[]) => void;
  onError: (msg: string) => void;
}) {
  const [newText, setNewText] = useState('');
  const [newCat, setNewCat] = useState<MemoryCategory>('other');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  async function add() {
    if (!newText.trim()) return;
    try {
      const fact = await addFact(settings, { text: newText.trim(), category: newCat });
      setFacts([...facts, fact]);
      setNewText('');
    } catch (e) {
      onError(errText(e));
    }
  }
  async function saveEdit(f: MemoryFact) {
    if (!editing?.text.trim()) return;
    try {
      const updated = await updateFact(settings, f.id, { text: editing.text.trim(), category: f.category });
      setFacts(facts.map((x) => (x.id === f.id ? updated : x)));
      setEditing(null);
    } catch (e) {
      onError(errText(e));
    }
  }
  async function remove(id: string) {
    try {
      await deleteFact(settings, id);
      setFacts(facts.filter((f) => f.id !== id));
    } catch (e) {
      onError(errText(e));
    }
  }

  return (
    <div className="space-y-2">
      {facts.length === 0 && <p className="text-xs text-slate-500">Nothing yet. Tell HirePilot about yourself in chat, or add a note here.</p>}
      {facts.map((f) => (
        <div key={f.id} className="flex items-start gap-2 rounded bg-slate-50 p-2 text-sm dark:bg-slate-900">
          <span className="mt-0.5 shrink-0 rounded bg-slate-200 px-1.5 text-[10px] uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            {f.category.replace('_', ' ')}
          </span>
          {editing?.id === f.id ? (
            <div className="flex-1 space-y-1">
              <textarea className={inputCls} rows={2} value={editing.text} onChange={(e) => setEditing({ id: f.id, text: e.target.value })} />
              <div className="flex gap-2">
                <button className={smallBtn} onClick={() => void saveEdit(f)}>Save</button>
                <button className={smallBtn} onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <span className="flex-1 break-words">{f.text}</span>
              <button className="text-xs text-slate-500 hover:underline" onClick={() => setEditing({ id: f.id, text: f.text })}>Edit</button>
              <button className="text-xs text-red-600 hover:underline" onClick={() => void remove(f.id)}>Delete</button>
            </>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <input className={inputCls} placeholder="e.g. Notice period is 30 days" value={newText} onChange={(e) => setNewText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
        <select className="rounded border border-slate-300 bg-transparent px-1 text-xs dark:border-slate-700" value={newCat} onChange={(e) => setNewCat(e.target.value as MemoryCategory)}>
          {MEMORY_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c.replace('_', ' ')}</option>
          ))}
        </select>
        <button className={smallBtn} onClick={() => void add()}>Add</button>
      </div>
    </div>
  );
}

/* ---------- the view ---------- */

export function ProfileView({ settings }: { settings: Settings }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // Latest profile, readable synchronously: a list field commits on blur, which
  // fires just before the Save click — save() must see that edit.
  const latest = useRef<Profile | null>(null);

  useEffect(() => {
    getProfile(settings)
      .then((r) => {
        setProfile(r.profile);
        latest.current = r.profile;
        setFacts(r.facts);
      })
      .catch((e) => setStatus({ kind: 'error', text: errText(e) }));
  }, [settings]);

  if (!profile) {
    return <div className="p-3 text-sm text-slate-500">{status ? <span className="text-red-600">{status.text}</span> : 'Loading profile…'}</div>;
  }

  const edit = (next: Profile) => {
    latest.current = next;
    setProfile(next);
    setDirty(true);
    setStatus(null);
  };
  const basics = (k: keyof Profile['basics']) => (v: string) => edit({ ...profile, basics: { ...profile.basics, [k]: v } });
  const links = (k: Exclude<keyof Profile['links'], 'other'>) => (v: string) => edit({ ...profile, links: { ...profile.links, [k]: v } });
  const prefs = <K extends keyof Profile['preferences']>(k: K) => (v: Profile['preferences'][K]) =>
    edit({ ...profile, preferences: { ...profile.preferences, [k]: v } });

  async function save() {
    const current = latest.current;
    if (!current) return;
    setSaving(true);
    try {
      const saved = await saveProfile(settings, current);
      latest.current = saved;
      setProfile(saved);
      setDirty(false);
      setStatus({ kind: 'ok', text: 'Saved.' });
    } catch (e) {
      setStatus({ kind: 'error', text: errText(e) });
    } finally {
      setSaving(false);
    }
  }

  /** Apply a reviewed resume import on top of the latest profile (incl. unsaved edits) and save. */
  async function applyResumeImport(proposed: Profile, sections: ImportSection[]) {
    const base = latest.current;
    if (!base) return;
    const saved = await saveProfile(settings, applyImport(base, proposed, sections));
    latest.current = saved;
    setProfile(saved);
    setDirty(false);
    setStatus({ kind: 'ok', text: 'Saved.' });
  }

  async function download() {
    try {
      const data = await exportData(settings);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `hirepilot-export-${data.exportedAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setStatus({ kind: 'error', text: errText(e) });
    }
  }

  const p = profile;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs text-slate-500">
          Everything here is treated as verified fact about you. HirePilot only uses what's saved here, and never makes up the rest.
        </p>

        <Section title="Resumes" defaultOpen>
          <ResumesSection settings={settings} getProfile={() => latest.current ?? p} onApplyImport={applyResumeImport} />
        </Section>

        <Section title="Basics" defaultOpen>
          <Field label="Full name" value={p.basics.fullName} onChange={basics('fullName')} />
          <Field label="Email" value={p.basics.email} onChange={basics('email')} />
          <Field label="Phone" value={p.basics.phone} onChange={basics('phone')} />
          <Field label="Location" value={p.basics.location} onChange={basics('location')} placeholder="Gurgaon, India" />
          <Field label="Headline" value={p.basics.headline} onChange={basics('headline')} placeholder="Full-stack & Solana engineer" />
          <Field label="Summary" value={p.basics.summary} onChange={basics('summary')} multiline />
        </Section>

        <Section title="Links">
          <Field label="LinkedIn" value={p.links.linkedin} onChange={links('linkedin')} />
          <Field label="GitHub" value={p.links.github} onChange={links('github')} />
          <Field label="Portfolio" value={p.links.portfolio} onChange={links('portfolio')} />
          <Field label="X (Twitter)" value={p.links.x} onChange={links('x')} />
          <ListField label="Other links (one per line)" separator="line" value={p.links.other} onChange={(v) => edit({ ...p, links: { ...p.links, other: v } })} />
        </Section>

        <Section title={`Skills${p.skills.length ? ` (${p.skills.length})` : ''}`}>
          <ListField label="Comma-separated" value={p.skills} onChange={(v) => edit({ ...p, skills: v })} placeholder="TypeScript, Rust, Solana, Next.js" />
        </Section>

        <Section title={`Experience${p.experience.length ? ` (${p.experience.length})` : ''}`}>
          <ItemList<Experience>
            items={p.experience}
            onChange={(experience) => edit({ ...p, experience })}
            blank={() => ({ id: newId(), company: '', title: '', location: '', startDate: '', endDate: '', current: false, highlights: [] })}
            title={(e) => [e.title, e.company].filter(Boolean).join(' · ')}
            render={(e, set) => (
              <>
                <Field label="Title" value={e.title} onChange={(v) => set({ title: v })} />
                <Field label="Company" value={e.company} onChange={(v) => set({ company: v })} />
                <Field label="Location" value={e.location} onChange={(v) => set({ location: v })} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Start" value={e.startDate} onChange={(v) => set({ startDate: v })} placeholder="Jan 2023" />
                  {!e.current && <Field label="End" value={e.endDate} onChange={(v) => set({ endDate: v })} placeholder="Mar 2025" />}
                </div>
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={e.current} onChange={(ev) => set({ current: ev.target.checked })} /> I currently work here
                </label>
                <ListField label="Highlights (one per line)" separator="line" value={e.highlights} onChange={(v) => set({ highlights: v })} />
              </>
            )}
          />
        </Section>

        <Section title={`Education${p.education.length ? ` (${p.education.length})` : ''}`}>
          <ItemList<Education>
            items={p.education}
            onChange={(education) => edit({ ...p, education })}
            blank={() => ({ id: newId(), institution: '', degree: '', field: '', startDate: '', endDate: '', grade: '' })}
            title={(e) => [e.degree, e.institution].filter(Boolean).join(' · ')}
            render={(e, set) => (
              <>
                <Field label="Institution" value={e.institution} onChange={(v) => set({ institution: v })} />
                <Field label="Degree" value={e.degree} onChange={(v) => set({ degree: v })} placeholder="MCA" />
                <Field label="Field" value={e.field} onChange={(v) => set({ field: v })} />
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Start" value={e.startDate} onChange={(v) => set({ startDate: v })} />
                  <Field label="End" value={e.endDate} onChange={(v) => set({ endDate: v })} />
                  <Field label="Grade" value={e.grade} onChange={(v) => set({ grade: v })} />
                </div>
              </>
            )}
          />
        </Section>

        <Section title={`Projects${p.projects.length ? ` (${p.projects.length})` : ''}`}>
          <ItemList<Project>
            items={p.projects}
            onChange={(projects) => edit({ ...p, projects })}
            blank={() => ({ id: newId(), name: '', url: '', description: '', tech: [] })}
            title={(pr) => pr.name}
            render={(pr, set) => (
              <>
                <Field label="Name" value={pr.name} onChange={(v) => set({ name: v })} />
                <Field label="URL" value={pr.url} onChange={(v) => set({ url: v })} />
                <Field label="Description" value={pr.description} onChange={(v) => set({ description: v })} multiline />
                <ListField label="Tech (comma-separated)" value={pr.tech} onChange={(v) => set({ tech: v })} />
              </>
            )}
          />
        </Section>

        <Section title="Job preferences">
          <ListField label="Target roles" value={p.preferences.roles} onChange={prefs('roles')} placeholder="Backend Engineer, Solana Developer" />
          <ListField label="Preferred locations" value={p.preferences.locations} onChange={prefs('locations')} placeholder="Bengaluru, Gurgaon, Remote" />
          <label className="block space-y-1">
            <span className="text-xs text-slate-500">Work mode</span>
            <select className={inputCls} value={p.preferences.workMode} onChange={(e) => prefs('workMode')(e.target.value as Profile['preferences']['workMode'])}>
              {WORK_MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <Field label="Notice period" value={p.preferences.noticePeriod} onChange={prefs('noticePeriod')} />
          <Field label="Current compensation" value={p.preferences.currentCompensation} onChange={prefs('currentCompensation')} />
          <Field label="Expected compensation" value={p.preferences.expectedCompensation} onChange={prefs('expectedCompensation')} />
          <Field label="Work authorization" value={p.preferences.workAuthorization} onChange={prefs('workAuthorization')} placeholder="Indian citizen; needs visa sponsorship for US" />
        </Section>

        <Section title={`Saved notes${facts.length ? ` (${facts.length})` : ''}`} defaultOpen={facts.length > 0}>
          <MemoryList settings={settings} facts={facts} setFacts={setFacts} onError={(t) => setStatus({ kind: 'error', text: t })} />
        </Section>

        <button className="text-xs text-slate-500 hover:underline" onClick={() => void download()}>
          Export all my data (JSON)
        </button>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 p-2 dark:border-slate-800">
        <span className={`text-xs ${status?.kind === 'error' ? 'text-red-600' : 'text-slate-500'}`}>
          {status?.text ?? (dirty ? 'Unsaved changes' : 'All changes saved')}
        </span>
        <button
          className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-500 disabled:opacity-50"
          onClick={() => void save()}
          disabled={!dirty || saving}
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  );
}
