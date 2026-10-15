import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LIMITS, PROFILE_FIELD_LABELS, type ChatMessage, type MemorySuggestion, type PageContext } from '@hirepilot/shared';
import { acceptSuggestion, sendChat } from '../lib/api';
import type { Settings } from '../lib/settings';
import { capturePage, PageAccessError, requestSiteAccess } from '../browser/pageSnapshot';
import { openMicPermissionPage, useSpeechRecognition } from '../voice/useSpeechRecognition';
import { useSpeechSynthesis } from '../voice/useSpeechSynthesis';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  /** true when the user spoke this message instead of typing it. */
  spoken?: boolean;
  /** Things HirePilot offers to remember; nothing is saved until the user clicks Save. */
  suggestions?: { item: MemorySuggestion; status: 'pending' | 'saving' | 'saved' | 'dismissed' | 'error' }[];
  /** Small summary of the page that was attached, shown under the user's message. */
  page?: { title: string; url: string; job?: string; truncated: boolean };
  /** Why the page wasn't attached, when "Include page" was on but the page couldn't be read. */
  pageNote?: string;
}

const STORE_KEY = 'chat';
const newId = () => crypto.randomUUID();

function pageSummary(p: PageContext): UiMessage['page'] {
  const job = p.jobPostings[0];
  return {
    title: p.title,
    url: p.url,
    job: job ? [job.title, job.company].filter(Boolean).join(' · ') : undefined,
    truncated: p.truncated,
  };
}

/** Only real user/assistant turns go to the model; error notices stay local. */
function toHistory(messages: UiMessage[]): ChatMessage[] {
  return messages
    .filter((m): m is UiMessage & { role: 'user' | 'assistant' } => m.role !== 'error')
    .map((m) => ({ role: m.role, content: m.content.slice(0, LIMITS.messageChars) }))
    .slice(-LIMITS.historyMessages);
}

export function Chat({ settings }: { settings: Settings }) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [includePage, setIncludePage] = useState(true);
  const [busy, setBusy] = useState<null | 'reading' | 'thinking'>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [needsMic, setNeedsMic] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the conversation across panel close/reopen (cleared when Chrome restarts).
  useEffect(() => {
    chrome.storage.session.get(STORE_KEY).then((s) => {
      if (Array.isArray(s[STORE_KEY])) setMessages(s[STORE_KEY] as UiMessage[]);
    });
  }, []);
  useEffect(() => {
    void chrome.storage.session.set({ [STORE_KEY]: messages });
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addError = (text: string) => setMessages((m) => [...m, { id: newId(), role: 'error', content: text }]);

  const tts = useSpeechSynthesis();
  // The recogniser calls back seconds after it starts; a ref makes sure it calls
  // the latest send() (with the latest messages), not the one from that render.
  const sendRef = useRef<(text?: string, spoken?: boolean) => Promise<void>>(async () => {});
  const voice = useSpeechRecognition({
    onInterim: (t) => setInput(t),
    onFinal: (t) => void sendRef.current(t, true),
    onError: (e) => {
      if (e.code === 'permission') setNeedsMic(true);
      else addError(e.message);
    },
  });

  function beginListening() {
    tts.stop(); // don't let HirePilot talk over you
    setInput('');
    void voice.start();
  }

  // Mic button: hold = push-to-talk (release sends); quick click = hands-free
  // (keeps listening through pauses until you click again).
  const HOLD_MS = 350;
  const pressRef = useRef<{ at: number; wasListening: boolean } | null>(null);
  function onMicDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pressRef.current = { at: Date.now(), wasListening: voice.listening };
    if (!voice.listening) beginListening();
  }
  function onMicUp() {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press) return;
    if (press.wasListening) voice.finish(); // second click in hands-free mode → send
    else if (Date.now() - press.at >= HOLD_MS) voice.finish(); // released after holding → send
    // else: quick click → stay in hands-free mode
  }

  // Keyboard: hold Option/Alt to talk, release to send. Esc cancels.
  // (Works while the side panel has focus — click inside it first.)
  useEffect(() => {
    const down = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Alt' && !e.repeat && !busy && !voice.listening) {
        e.preventDefault();
        beginListening();
      } else if (e.key === 'Escape' && voice.listening) {
        voice.cancel();
        setInput('');
      }
    };
    const up = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Alt') voice.finish();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  async function send(override?: string, spoken = false) {
    const text = (override ?? input).trim();
    if (!text || busy) return;

    let page: PageContext | undefined;
    let pageNote: string | undefined;
    if (includePage) {
      setBusy('reading');
      try {
        page = await capturePage();
      } catch (err) {
        if (err instanceof PageAccessError && err.needsPermission) {
          // Fixable by the user: stop and show the "Allow" banner, keep the typed text.
          setBusy(null);
          setNeedsPermission(true);
          return;
        }
        // Unreadable page (chrome://, new tab, store…): don't block the chat, just say so.
        pageNote = err instanceof Error ? err.message : String(err);
      }
    }

    const userMsg: UiMessage = {
      id: newId(),
      role: 'user',
      content: text,
      spoken,
      page: page && pageSummary(page),
      pageNote,
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setBusy('thinking');

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { reply, suggestions } = await sendChat(settings, { messages: toHistory(next), pageContext: page }, controller.signal);
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: 'assistant',
          content: reply,
          suggestions: suggestions.length ? suggestions.map((item) => ({ item, status: 'pending' as const })) : undefined,
        },
      ]);
      // Talk back when you talked to it.
      if (spoken && speakReplies) tts.speak(reply);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') addError('Stopped.');
      else addError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  }

  sendRef.current = send;

  function setSuggestionStatus(msgId: string, index: number, status: NonNullable<UiMessage['suggestions']>[number]['status']) {
    setMessages((all) =>
      all.map((m) =>
        m.id === msgId && m.suggestions
          ? { ...m, suggestions: m.suggestions.map((s, i) => (i === index ? { ...s, status } : s)) }
          : m,
      ),
    );
  }

  async function onAcceptSuggestion(msgId: string, index: number, item: MemorySuggestion) {
    setSuggestionStatus(msgId, index, 'saving');
    try {
      await acceptSuggestion(settings, item);
      setSuggestionStatus(msgId, index, 'saved');
    } catch (err) {
      setSuggestionStatus(msgId, index, 'error');
      addError(err instanceof Error ? err.message : String(err));
    }
  }

  function grant() {
    // Called straight from the click: Chrome only shows the prompt during a user gesture.
    requestSiteAccess().then((ok) => {
      setNeedsPermission(!ok);
      if (!ok) addError('Page access was not granted. You can still chat with "Include page" off.');
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {messages.length === 0 && (
          <div className="mt-8 space-y-2 text-center text-slate-500">
            <p>Open a job post and ask something like:</p>
            <p className="italic">"Summarise this job and list the must-have skills."</p>
            <p className="italic">"Who's hiring in this post and how do I apply?"</p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onAccept={(i, item) => void onAcceptSuggestion(m.id, i, item)}
            onDismiss={(i) => setSuggestionStatus(m.id, i, 'dismissed')}
          />
        ))}
        {busy && (
          <p className="text-xs text-slate-500">{busy === 'reading' ? 'Reading page…' : 'Thinking…'}</p>
        )}
        <div ref={bottomRef} />
      </div>

      {needsPermission && (
        <div className="mx-3 mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <p className="mb-2">
            To read pages, Chrome needs your OK once. HirePilot only reads a page when you send a message with
            "Include page" on.
          </p>
          <button className="rounded bg-amber-600 px-2 py-1 text-white" onClick={grant}>
            Allow page reading
          </button>
        </div>
      )}

      {needsMic && (
        <div className="mx-3 mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <p className="mb-2">
            Chrome can't ask for the microphone inside a side panel, so it opens a tab once to ask. Allow it there,
            then come back and click the mic.
          </p>
          <button
            className="rounded bg-amber-600 px-2 py-1 text-white"
            onClick={() => {
              setNeedsMic(false);
              openMicPermissionPage();
            }}
          >
            Allow microphone
          </button>
        </div>
      )}

      <div className="border-t border-slate-200 p-2 dark:border-slate-800">
        <textarea
          className="w-full resize-none rounded border border-slate-300 bg-transparent p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700"
          rows={3}
          placeholder={
            voice.listening
              ? 'Listening… release (or click 🎤 again) to send · Esc to cancel'
              : 'Type, or hold ⌥ Option / 🎤 to talk'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy === 'reading' || voice.listening}
        />
        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={includePage} onChange={(e) => setIncludePage(e.target.checked)} />
              Include page
            </label>
            {tts.supported && (
              <label className="flex items-center gap-1.5" title="Read replies aloud when you ask by voice">
                <input type="checkbox" checked={speakReplies} onChange={(e) => {
                  setSpeakReplies(e.target.checked);
                  if (!e.target.checked) tts.stop();
                }} />
                Speak replies
              </label>
            )}
          </div>
          <div className="flex gap-2">
            {tts.speaking && (
              <button className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700" onClick={tts.stop}>
                Stop speaking
              </button>
            )}
            {voice.supported && (
              <button
                className={`rounded px-2.5 py-1 text-xs ${
                  voice.listening
                    ? 'animate-pulse bg-red-600 text-white'
                    : 'border border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800'
                }`}
                onPointerDown={onMicDown}
                onPointerUp={onMicUp}
                disabled={!!busy}
                title="Hold to talk (or hold ⌥ Option), release to send. Click once for hands-free; click again to send."
              >
                {voice.listening ? '● Listening' : '🎤'}
              </button>
            )}
            {messages.length > 0 && !busy && (
              <button className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setMessages([])}>
                Clear
              </button>
            )}
            {busy === 'thinking' ? (
              <button className="rounded border border-slate-300 px-3 py-1 text-xs dark:border-slate-700" onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            ) : (
              <button
                className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-500 disabled:opacity-50"
                onClick={() => void send()}
                disabled={!input.trim() || !!busy}
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function describeSuggestion(s: MemorySuggestion): { label: string; value: string } {
  return s.type === 'profile'
    ? { label: PROFILE_FIELD_LABELS[s.field], value: s.value }
    : { label: `Note · ${s.category.replace('_', ' ')}`, value: s.text };
}

function MessageBubble({ message: m, onAccept, onDismiss }: {
  message: UiMessage;
  onAccept: (index: number, item: MemorySuggestion) => void;
  onDismiss: (index: number) => void;
}) {
  if (m.role === 'error') {
    return <p className="rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">{m.content}</p>;
  }
  const isUser = m.role === 'user';
  return (
    <div className={isUser ? 'ml-6' : 'mr-6'}>
      <div
        className={`whitespace-pre-wrap break-words rounded-lg p-2 ${
          isUser ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800'
        }`}
      >
        {m.content}
      </div>
      {m.page && (
        <p className="mt-1 truncate text-[11px] text-slate-500" title={m.page.url}>
          📄 {m.page.job ? `Job: ${m.page.job}` : m.page.title || m.page.url}
          {m.page.truncated ? ' (long page, trimmed)' : ''}
        </p>
      )}
      {m.suggestions?.map((s, i) => {
        if (s.status === 'dismissed') return null;
        const { label, value } = describeSuggestion(s.item);
        return (
          <div key={i} className="mt-2 rounded border border-indigo-300 p-2 text-xs dark:border-indigo-800">
            <p className="text-slate-500">Save to your profile?</p>
            <p className="my-1">
              <span className="font-medium">{label}:</span> {value}
            </p>
            {s.status === 'saved' ? (
              <p className="text-emerald-600">✓ Saved</p>
            ) : (
              <div className="flex gap-2">
                <button
                  className="rounded bg-indigo-600 px-2 py-0.5 text-white disabled:opacity-50"
                  disabled={s.status === 'saving'}
                  onClick={() => onAccept(i, s.item)}
                >
                  {s.status === 'saving' ? 'Saving…' : s.status === 'error' ? 'Retry' : 'Save'}
                </button>
                <button className="rounded px-2 py-0.5 text-slate-500 hover:underline" onClick={() => onDismiss(i)}>
                  Dismiss
                </button>
              </div>
            )}
          </div>
        );
      })}
      {m.spoken && <p className="mt-1 text-[11px] text-slate-500">🎤 spoken</p>}
      {m.pageNote && <p className="mt-1 text-[11px] text-slate-500">Page not included: {m.pageNote}</p>}
    </div>
  );
}
