import React from 'react';
import { Loader2, Mic, MicOff } from './icons';
import { cn } from '../lib/utils';
import { useVoiceInput, voiceErrorMessage } from '../hooks/useVoiceInput';

interface VoiceButtonProps {
  /** Called with each final dictated phrase. Append it to your field value. */
  onTranscript: (text: string) => void;
  /** Optional live caption of words still being recognised. */
  onInterim?: (text: string) => void;
  lang?: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  /** Visual treatment for dark on-colour buttons. */
  variant?: 'ghost' | 'solid' | 'inverted';
  label?: string;
}

const SIZE_CLASSES: Record<NonNullable<VoiceButtonProps['size']>, string> = {
  xs: 'p-1',
  sm: 'p-1.5',
  md: 'p-2.5',
};

const ICON_CLASSES: Record<NonNullable<VoiceButtonProps['size']>, string> = {
  xs: 'w-3 h-3',
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
};

const VARIANT_CLASSES: Record<NonNullable<VoiceButtonProps['variant']>, string> = {
  ghost: 'text-muted-foreground hover:text-primary hover:bg-primary/10',
  solid: 'bg-card border border-border text-muted-foreground hover:bg-muted shadow-sm',
  inverted: 'bg-card/15 text-primary-foreground hover:bg-card/25',
};

/**
 * One mic control for the entire app: tap to dictate, tap again to stop.
 * Text is appended to the caller's field, never replacing what is there.
 */
const VoiceButton: React.FC<VoiceButtonProps> = ({
  onTranscript,
  onInterim,
  lang,
  size = 'md',
  className,
  variant = 'ghost',
  label,
}) => {
  const { supported, isListening, error, errorMessage, toggle } = useVoiceInput(onTranscript, {
    lang,
    onInterim,
  });

  const title = !supported
    ? voiceErrorMessage('unsupported')
    : errorMessage || (isListening ? 'Stop dictating' : label || 'Dictate with your voice');

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (supported) toggle();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      disabled={!supported}
      aria-label={isListening ? 'Stop voice dictation' : 'Start voice dictation'}
      aria-pressed={isListening}
      title={title}
      className={cn(
        'relative inline-flex items-center justify-center rounded-full transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        isListening && 'bg-rose-500 text-primary-foreground hover:bg-rose-500/90 animate-pulse',
        error && !isListening && 'text-rose-500',
        className,
      )}
    >
      {isListening && (
        <span className="absolute inset-0 rounded-full bg-rose-500/30 animate-ping pointer-events-none" />
      )}
      {isListening ? (
        <MicOff className={cn(ICON_CLASSES[size], 'relative')} />
      ) : (
        <Mic className={cn(ICON_CLASSES[size], 'relative')} />
      )}
      <span className="sr-only" role="status">
        {isListening ? 'Listening for speech' : errorMessage || ''}
      </span>
    </button>
  );
};

export default VoiceButton;

/** Small helper so pages can render a spinner while keeping the mic visible. */
export const VoiceButtonShell = ({ className }: { className?: string }) => (
  <div className={cn('inline-flex items-center justify-center p-2.5', className)}>
    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
  </div>
);
