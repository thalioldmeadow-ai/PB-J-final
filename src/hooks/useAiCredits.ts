import { useCallback, useEffect, useState } from 'react';
import { fetchCreditSummary, notifyCreditChange } from '../lib/aiCredits';
import type { AiCreditSummary } from '../types';

/** Load the caller's own credit balance and refresh it after AI requests. */
export const useAiCredits = (user?: string) => {
  const [summary, setSummary] = useState<AiCreditSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setSummary(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await fetchCreditSummary(user);
      setSummary(next);
      setError(next ? null : 'Your AI credits could not be loaded.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your AI credits could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
    const handleChange = () => void refresh();
    window.addEventListener('ai-credits-update', handleChange as EventListener);
    return () => window.removeEventListener('ai-credits-update', handleChange as EventListener);
  }, [refresh]);

  return { summary, loading, error, refresh, notify: notifyCreditChange };
};
