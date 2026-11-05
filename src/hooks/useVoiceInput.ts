import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared voice-to-text engine for the whole app.
 *
 * Uses the Web Speech API where available and keeps listening through the
 * pauses where Chrome/Safari otherwise end the session. Final phrases are
 * handed to `onTranscript` one at a time so callers can append them to
 * whatever text field is focused.
 */

type RecognitionResultList = {
  length: number;
  [index: number]: {
    isFinal: boolean;
    0: { transcript: string };
  };
};

type RecognitionEvent = {
  resultIndex: number;
  results: RecognitionResultList;
};

type RecognitionErrorEvent = {
  error?: string;
  message?: string;
};

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type RecognitionCtor = new () => Recognition;

const getRecognitionCtor = (): RecognitionCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

/** True when this browser can do speech recognition at all. */
export const isVoiceRecognitionSupported = () => getRecognitionCtor() !== null;

/** Errors that retrying cannot fix (permission denied, no mic, blocked origin). */
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

export const voiceErrorMessage = (code: string | null): string => {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow the microphone for this site in your browser settings.';
    case 'audio-capture':
      return 'No microphone was found. Connect a mic and try again.';
    case 'network':
      return 'Voice recognition needs an internet connection. Check your network and try again.';
    case 'no-speech':
      return 'No speech detected, tap the mic and try again.';
    case 'unsupported':
      return 'Voice input is not supported in this browser. Try Chrome, Edge or Safari.';
    case 'start-failed':
      return 'Voice input could not start. Tap the mic to try again.';
    default:
      return 'Voice input stopped unexpectedly. Tap the mic to try again.';
  }
};

/**
 * Adds dictated words to an existing value without gluing words together or
 * leaving double spaces behind.
 */
export const appendDictation = (current: string, addition: string): string => {
  const extra = addition.replace(/\s+/g, ' ').trim();
  if (!extra) return current;
  if (!current.trim()) return extra;
  return /[\s([{"'“‘\-–, /]$/.test(current) ? `${current}${extra}` : `${current} ${extra}`;
};

interface UseVoiceInputOptions {
  lang?: string;
  /** Optional live (not yet final) words, useful for showing progress. */
  onInterim?: (text: string) => void;
}

export function useVoiceInput(
  onTranscript: (text: string) => void,
  { lang = 'en-US', onInterim }: UseVoiceInputOptions = {},
) {
  const supported = isVoiceRecognitionSupported();
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcriptRef = useRef(onTranscript);
  const interimRef = useRef(onInterim);
  const recognitionRef = useRef<Recognition | null>(null);
  const shouldListenRef = useRef(false);
  const fatalRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const beginRef = useRef<() => void>(() => {});

  transcriptRef.current = onTranscript;
  interimRef.current = onInterim;

  const clearRestartTimer = () => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const begin = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError('unsupported');
      return;
    }

    // Drop the old session before opening a new one (autoplay/silence restarts).
    const previous = recognitionRef.current;
    if (previous) {
      previous.onresult = null;
      previous.onerror = null;
      previous.onend = null;
      try {
        previous.abort();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = lang;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const words = result[0]?.transcript || '';
        if (result.isFinal) {
          if (words.trim()) transcriptRef.current(words);
        } else {
          interim += words;
        }
      }
      if (interimRef.current) interimRef.current(interim.trim());
    };

    recognition.onerror = (event) => {
      const code = event.error || 'unknown';
      if (FATAL_ERRORS.has(code)) {
        fatalRef.current = true;
        shouldListenRef.current = false;
        setIsListening(false);
      }
      // 'no-speech' and 'aborted' are routine; the session simply restarts.
      if (code !== 'no-speech' && code !== 'aborted') {
        console.warn('Voice input error:', code, event.message || '');
        setError(code);
      }
    };

    recognition.onend = () => {
      if (interimRef.current) interimRef.current('');
      if (!shouldListenRef.current || fatalRef.current) {
        setIsListening(false);
        return;
      }
      // Browsers end the session after a short silence even in continuous mode.
      clearRestartTimer();
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        if (shouldListenRef.current && !fatalRef.current) beginRef.current();
      }, 300);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      shouldListenRef.current = true;
      setIsListening(true);
      setError(null);
    } catch {
      // Chrome throws if start() races an existing session; treat as retryable.
      setError('start-failed');
      setIsListening(false);
    }
  }, [lang]);

  useEffect(() => {
    beginRef.current = begin;
  }, [begin]);

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    clearRestartTimer();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      recognition.onresult = null;
      try {
        recognition.stop();
      } catch {
        try {
          recognition.abort();
        } catch {
          /* already stopped */
        }
      }
    }
    if (interimRef.current) interimRef.current('');
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    fatalRef.current = false;
    setError(null);
    begin();
  }, [begin]);

  const toggle = useCallback(() => {
    if (shouldListenRef.current) stop();
    else start();
  }, [start, stop]);

  // Release the microphone if the field unmounts mid-dictation.
  useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onend = null;
        recognition.onresult = null;
        recognition.onerror = null;
        try {
          recognition.abort();
        } catch {
          /* already stopped */
        }
      }
      recognitionRef.current = null;
    };
  }, []);

  return {
    supported,
    isListening,
    error,
    errorMessage: error ? voiceErrorMessage(error) : null,
    start,
    stop,
    toggle,
  };
}
