import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Speech-to-text with Chrome's built-in Web Speech API.
 * - Free, no API key. Chrome streams the audio to Google's speech service to transcribe it.
 * - A side panel can't show Chrome's microphone prompt, so permission is granted once
 *   on a normal extension tab (permission.html). After that the panel can use the mic.
 */

// TypeScript's DOM types don't include the Web Speech API, so we declare the parts we use.
interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike { isFinal: boolean; 0: SpeechRecognitionAlternativeLike }
interface SpeechRecognitionEventLike { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }
interface SpeechRecognitionErrorEventLike { error: string }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export type VoiceErrorCode = 'unsupported' | 'permission' | 'blocked' | 'no-speech' | 'network' | 'other';
export interface VoiceError { code: VoiceErrorCode; message: string }

async function micPermissionState(): Promise<PermissionState | 'unknown'> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

/** Opens the one-time page where Chrome can show its microphone prompt. */
export function openMicPermissionPage(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
}

function toVoiceError(code: string): VoiceError {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return { code: 'permission', message: 'HirePilot needs microphone access.' };
    case 'no-speech':
      return { code: 'no-speech', message: "Didn't hear anything. Click the mic and try again." };
    case 'audio-capture':
      return { code: 'other', message: 'No microphone found. Check your mic in macOS settings.' };
    case 'network':
      return { code: 'network', message: "Couldn't reach Chrome's speech service. Check your internet connection." };
    default:
      return { code: 'other', message: `Voice input error: ${code}` };
  }
}

interface Options {
  lang?: string;
  /** Live transcript while you're still talking. */
  onInterim: (text: string) => void;
  /** Called once when you finish, with the full transcript. */
  onFinal: (text: string) => void;
  onError: (error: VoiceError) => void;
}

/**
 * Listening is controlled by YOU, not by Chrome's silence detection:
 * - start() begins listening and keeps going through pauses.
 * - finish() stops and sends everything heard.
 * - cancel() stops and throws it away.
 * Chrome still ends a recognition session on its own after long silence or
 * ~60s; while you're still holding/listening we quietly start a new session and
 * keep appending, so the transcript isn't cut.
 */
export function useSpeechRecognition(options: Options) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantRef = useRef(false); // does the user still want us listening?
  const cancelledRef = useRef(false);
  const textRef = useRef(''); // final text from earlier sessions
  const optsRef = useRef(options);
  optsRef.current = options;
  const lang = options.lang ?? 'en-IN';

  const supported = getRecognitionCtor() !== undefined;

  const finishUp = useCallback(() => {
    recRef.current = null;
    wantRef.current = false;
    setListening(false);
    const text = textRef.current.trim();
    textRef.current = '';
    if (text && !cancelledRef.current) optsRef.current.onFinal(text);
  }, []);

  const startSession = useCallback(
    (Ctor: SpeechRecognitionCtor) => {
      const rec = new Ctor();
      rec.lang = lang;
      rec.continuous = true; // don't stop at the first pause
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      let sessionFinal = '';
      rec.onresult = (e) => {
        // Recompute from all results: robust against how browsers re-send them.
        let finals = '';
        let interim = '';
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i];
          if (!r) continue;
          if (r.isFinal) finals += r[0].transcript;
          else interim += r[0].transcript;
        }
        sessionFinal = finals;
        optsRef.current.onInterim(`${textRef.current} ${finals}${interim}`.replace(/\s+/g, ' ').trim());
      };
      rec.onerror = (e) => {
        if (e.error === 'aborted') return;
        // Silence while you're still holding isn't an error: onend restarts us.
        if (e.error === 'no-speech' && wantRef.current) return;
        wantRef.current = false;
        optsRef.current.onError(toVoiceError(e.error));
      };
      rec.onend = () => {
        textRef.current = `${textRef.current} ${sessionFinal}`.replace(/\s+/g, ' ').trim();
        if (wantRef.current && !cancelledRef.current) {
          try {
            startSession(Ctor);
            return;
          } catch {
            /* fall through and finish with what we have */
          }
        }
        finishUp();
      };

      rec.start();
      recRef.current = rec;
    },
    [lang, finishUp],
  );

  const start = useCallback(async () => {
    if (wantRef.current) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      optsRef.current.onError({ code: 'unsupported', message: 'Voice input is not supported in this browser.' });
      return;
    }
    wantRef.current = true;
    cancelledRef.current = false;
    textRef.current = '';

    const state = await micPermissionState();
    if (!wantRef.current) return; // released before we even started
    if (state === 'denied' || state === 'prompt') {
      wantRef.current = false;
      optsRef.current.onError(
        state === 'denied'
          ? {
              code: 'blocked',
              message: 'Microphone is blocked for HirePilot. Allow it in chrome://settings/content/microphone, then try again.',
            }
          : { code: 'permission', message: 'HirePilot needs microphone access (one time).' },
      );
      return;
    }

    try {
      startSession(Ctor);
      setListening(true);
    } catch (err) {
      wantRef.current = false;
      optsRef.current.onError({ code: 'other', message: `Couldn't start voice input: ${String(err)}` });
    }
  }, [startSession]);

  /** Stop and send everything heard. */
  const finish = useCallback(() => {
    if (!wantRef.current && !recRef.current) return;
    wantRef.current = false;
    if (recRef.current) recRef.current.stop(); // onend → finishUp → onFinal
    else setListening(false);
  }, []);

  /** Stop and discard. */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    wantRef.current = false;
    recRef.current?.abort();
    textRef.current = '';
    setListening(false);
  }, []);

  useEffect(
    () => () => {
      cancelledRef.current = true;
      wantRef.current = false;
      recRef.current?.abort();
    },
    [],
  );

  return { supported, listening, start, finish, cancel };
}
