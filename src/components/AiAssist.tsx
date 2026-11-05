import React, { useState } from 'react';
import { useTheme } from './ThemeProvider';
import { useAuth } from './AuthProvider';
import { Lightbulb, Loader2, Send, X } from './icons';
import { AiFeatureMode, AiRequestError, askAi } from '../lib/ai';
import {
  AiActionName,
  AiActionProposal,
  applyProposal,
  proposalFromReply,
  stripProposalBlock,
} from '../lib/aiActions';
import { cn } from '../lib/utils';

/**
 * The in-page assistant.
 *
 * It sits inside a section rather than replacing the screen: a compact row that
 * opens when tapped, some suggestions drawn from that section, and one answer
 * area. Verified figures come in through `context`, and any change the model
 * wants to make arrives as a proposal that needs a second, explicit tap.
 */

export interface AiSuggestion {
  label: string;
  prompt: string;
}

interface Props {
  title: string;
  description?: string;
  suggestions: AiSuggestion[];
  mode: AiFeatureMode;
  context: () => Promise<Record<string, unknown>>;
  allowActions?: AiActionName[];
  onApplied?: () => void;
  className?: string;
}

const AiAssist: React.FC<Props> = ({
  title,
  description,
  suggestions,
  mode,
  context,
  allowActions = [],
  onApplied,
  className,
}) => {
  const { settings } = useTheme();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<AiActionProposal | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  const assistantOff = settings.aiEnabled === false;

  const ask = async (message: string) => {
    const clean = message.trim();
    if (!clean || pending) return;
    setPending(true);
    setError(null);
    setAnswer('');
    setProposal(null);
    setApplied(null);

    try {
      const result = await askAi({
        message: clean,
        mode,
        actions: allowActions,
        context: await context(),
        // Section panels follow the same age rules and quotas as the coach.
        ageBand: settings.aiAgeBand || 'adult',
        name: user?.displayName,
        user: user?.uid,
      });
      setAnswer(stripProposalBlock(result.reply));
      setProposal(proposalFromReply(result.reply, allowActions));
      setInput('');
    } catch (caught) {
      setError(
        caught instanceof AiRequestError
          ? caught.message
          : 'The assistant could not answer just now. Try again.'
      );
    } finally {
      setPending(false);
    }
  };

  const apply = async () => {
    if (!proposal || applying) return;
    setApplying(true);
    setError(null);
    const result = await applyProposal(proposal, allowActions);
    if (result.ok) {
      setApplied(result.message);
      setProposal(null);
      onApplied?.();
    } else {
      setError(result.message);
    }
    setApplying(false);
  };

  return (
    <section className={cn('rounded-sm bg-card border border-primary/10 shadow-sm', className)}>
      <button
        onClick={() => setOpen((previous) => !previous)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <span className="p-2 rounded-full bg-primary/10 text-primary shrink-0">
          <Lightbulb className="w-4 h-4" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
            Assistant
          </span>
          <span className="block text-sm font-semibold tracking-tight truncate">{title}</span>
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-primary shrink-0">
          {open ? 'Close' : 'Ask'}
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-3 border-t border-border/60 pt-4">
          {description && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">{description}</p>
          )}

          {assistantOff ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              The assistant is switched off in Settings. Everything on this screen still works without it.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.label}
                    onClick={() => ask(suggestion.prompt)}
                    disabled={pending}
                    className="px-3 py-1.5 rounded-full border border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-50"
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void ask(input);
                }}
                className="flex gap-2"
              >
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask about this section..."
                  aria-label={`Ask the assistant about ${title}`}
                  className="flex-1 min-w-0 px-4 py-3 rounded-2xl bg-muted text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  type="submit"
                  disabled={pending || !input.trim()}
                  aria-label="Send"
                  className="p-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-40 transition-opacity"
                >
                  {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </form>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200">
                  <p className="flex-1 text-[11px] text-rose-700 leading-relaxed">{error}</p>
                  <button onClick={() => setError(null)} aria-label="Dismiss error" className="text-rose-400">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {answer && (
                <div className="p-4 rounded-2xl bg-muted/50 space-y-1">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                    Answer
                  </p>
                  <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{answer}</p>
                </div>
              )}

              {proposal && (
                <div className="p-4 rounded-2xl border border-primary/30 bg-primary/5 space-y-3">
                  <div className="space-y-1">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-primary">
                      Proposed change
                    </p>
                    <p className="text-xs font-medium leading-relaxed">{proposal.summary}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Nothing has been saved yet. Check it, then apply or cancel.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setProposal(null)}
                      disabled={applying}
                      className="flex-1 py-2.5 rounded-xl bg-muted text-[10px] font-bold uppercase tracking-widest"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={apply}
                      disabled={applying}
                      className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-widest disabled:opacity-50"
                    >
                      {applying ? 'Applying' : 'Apply'}
                    </button>
                  </div>
                </div>
              )}

              {applied && (
                <p className="text-[11px] text-primary font-semibold leading-relaxed">{applied}</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
};

export default AiAssist;
