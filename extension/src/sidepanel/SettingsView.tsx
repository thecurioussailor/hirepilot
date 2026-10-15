import { useEffect, useState } from 'react';
import { checkHealth } from '../lib/api';
import { saveSettings, type Settings } from '../lib/settings';
import { hasSiteAccess, requestSiteAccess } from '../browser/pageSnapshot';

export function SettingsView({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [siteAccess, setSiteAccess] = useState<boolean | null>(null);

  useEffect(() => {
    hasSiteAccess().then(setSiteAccess).catch(() => setSiteAccess(false));
  }, []);

  async function test() {
    setStatus(null);
    try {
      const h = await checkHealth(draft);
      setStatus({ kind: 'ok', text: `Connected. Model: ${h.model}` });
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function save() {
    try {
      await saveSettings(draft);
      onSaved(draft);
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'Invalid settings' });
    }
  }

  const input =
    'w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-3 text-sm">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-500">Server URL</span>
        <input className={input} value={draft.serverUrl} onChange={(e) => setDraft({ ...draft, serverUrl: e.target.value })} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-slate-500">Server token (HIREPILOT_TOKEN from server/.env)</span>
        <input
          className={input}
          type="password"
          value={draft.token}
          onChange={(e) => setDraft({ ...draft, token: e.target.value.trim() })}
        />
      </label>
      <div className="flex gap-2">
        <button className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-500" onClick={save}>
          Save
        </button>
        <button className="rounded border border-slate-300 px-3 py-1.5 dark:border-slate-700" onClick={test}>
          Test connection
        </button>
      </div>
      {status && (
        <p className={status.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}>{status.text}</p>
      )}

      <div className="space-y-1 border-t border-slate-200 pt-4 dark:border-slate-800">
        <p className="text-xs font-medium text-slate-500">Page reading</p>
        {siteAccess ? (
          <p>Allowed. HirePilot only reads a page when you send a message with "Include page" on.</p>
        ) : (
          <button
            className="rounded border border-slate-300 px-3 py-1.5 dark:border-slate-700"
            onClick={() => requestSiteAccess().then(setSiteAccess)}
          >
            Allow HirePilot to read pages
          </button>
        )}
      </div>
    </div>
  );
}
