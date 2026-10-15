import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, loadSettings, type Settings } from '../lib/settings';
import { Chat } from './Chat';
import { ProfileView } from './ProfileView';
import { SettingsView } from './SettingsView';

type View = 'chat' | 'profile' | 'settings';
const TABS: { id: View; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'profile', label: 'Profile' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [view, setView] = useState<View>('chat');

  useEffect(() => {
    loadSettings()
      .then((s) => {
        setSettings(s);
        if (!s.token) setView('settings'); // first run → go straight to setup
      })
      .catch(() => setSettings(DEFAULT_SETTINGS));
  }, []);

  if (!settings) return null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <h1 className="text-sm font-semibold tracking-tight">HirePilot</h1>
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`rounded px-2 py-1 text-xs ${
                view === t.id
                  ? 'bg-slate-200 font-medium dark:bg-slate-800'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              onClick={() => setView(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      {view === 'chat' && <Chat settings={settings} />}
      {view === 'profile' && <ProfileView settings={settings} />}
      {view === 'settings' && (
        <SettingsView
          settings={settings}
          onSaved={(s) => {
            setSettings(s);
            setView('chat');
          }}
        />
      )}
    </div>
  );
}
