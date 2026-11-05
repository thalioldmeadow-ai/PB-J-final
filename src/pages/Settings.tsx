import React, { useEffect, useState } from 'react';
import { useTheme } from '../components/ThemeProvider';
import { useAuth } from '../components/AuthProvider';
import { ThemeType, FontSizeType, FontType, ScheduleIntervalType, Routine, AiMemoryFact, AiStatus, AiProviderChoice, AiAgeBand } from '../types';
import { Palette, Type, Layout, Shield, LogOut, Info, ChevronRight, Clock, Flame, Smartphone, ShieldCheck, Lightbulb } from '../components/icons';
import { cn } from '../lib/utils';
import { Link } from 'react-router-dom';
import { storage } from '../lib/storage';
import { fetchAiStatus } from '../lib/ai';
import SubscriptionPanel from '../components/SubscriptionPanel';
import {
  MEMORY_KINDS,
  MemoryKind,
  addMemory,
  clearMemory,
  forgetMemory,
  isMemoryKind,
  loadMemory,
  updateMemory,
} from '../lib/aiMemory';

const todayKey = () => new Date().toISOString().split('T')[0];
const yesterdayKey = () => new Date(Date.now() - 86400000).toISOString().split('T')[0];

const currentStreak = (routine: Routine) => {
  const last = routine.lastCompletedDate;
  if (!last || (last !== todayKey() && last !== yesterdayKey())) return 0;
  return routine.streak || 0;
};

const Settings: React.FC = () => {
  const { settings, updateSettings } = useTheme();
  const { user, signOut, loading: authLoading } = useAuth();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [facts, setFacts] = useState<AiMemoryFact[]>([]);
  const [newFact, setNewFact] = useState('');
  const [newKind, setNewKind] = useState<MemoryKind>('preference');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editKind, setEditKind] = useState<MemoryKind>('note');
  const [memoryError, setMemoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [liveStatus, memory] = await Promise.all([fetchAiStatus(user?.uid), loadMemory()]);
      if (cancelled) return;
      setAiStatus(liveStatus);
      setFacts(memory);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const removeFact = async (id: string) => {
    await forgetMemory(id);
    setFacts(await loadMemory());
  };

  const emptyMemory = async () => {
    await clearMemory();
    setFacts([]);
    setEditingId(null);
  };

  const addFact = async () => {
    setMemoryError(null);
    const saved = await addMemory(newFact, newKind, 'manual');
    if (!saved) {
      setMemoryError('That is empty, too short, or already saved.');
      return;
    }
    setNewFact('');
    setFacts(await loadMemory());
  };

  const beginEdit = (fact: AiMemoryFact) => {
    setEditingId(fact.id);
    setEditText(fact.text);
    setEditKind(isMemoryKind(fact.kind) ? fact.kind : 'note');
    setMemoryError(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const ok = await updateMemory(editingId, { text: editText, kind: editKind });
    if (!ok) {
      setMemoryError('Could not save that. Keep it at least three characters and different from your other notes.');
      return;
    }
    setEditingId(null);
    setMemoryError(null);
    setFacts(await loadMemory());
  };

  const memoryOn = settings.aiMemoryEnabled !== false;

  const selectedProvider = settings.aiProvider || 'auto';
  const available = aiStatus?.providers.filter((provider) => provider.enabled) || [];
  const unavailable = aiStatus?.providers.filter((provider) => !provider.enabled) || [];
  const ageBands: { id: AiAgeBand; label: string; hint: string }[] = [
    { id: 'adult', label: 'Adult', hint: 'Standard rules' },
    { id: 'teen', label: 'Teen', hint: 'Stricter, age-appropriate' },
    { id: 'child', label: 'Under 13', hint: 'Simplest, no unsafe topics' },
  ];

  useEffect(() => {
    const unsub = storage.subscribe(storage.key.ROUTINES, (data) => {
      const docs = data as Routine[];
      docs.sort((a, b) => (a.order || 0) - (b.order || 0));
      setRoutines(docs);
    });
    return () => unsub();
  }, []);

  const toggleStreak = async (routine: Routine) => {
    try {
      await storage.update(storage.key.ROUTINES, routine.id, { streakEnabled: !routine.streakEnabled });
    } catch (error) {
      console.error('Error updating routine streak setting:', error);
    }
  };

  const themes: { id: ThemeType; label: string; color: string }[] = [
    { id: 'beige', label: 'Beige', color: 'bg-background' },
    { id: 'orange', label: 'Orange', color: 'bg-[#F97316]' },
    { id: 'green', label: 'Green', color: 'bg-[#418252]' },
    { id: 'blue', label: 'Blue', color: 'bg-[#3AA4E2]' },
    { id: 'pink', label: 'Pink', color: 'bg-[#F9A4C0]' },
    { id: 'dark', label: 'Dark', color: 'bg-[#121212]' },
  ];

  const fontSizes: { id: FontSizeType; label: string }[] = [
    { id: 'small', label: 'Small' },
    { id: 'medium', label: 'Medium' },
    { id: 'large', label: 'Large' },
  ];

  return (
    <div className="space-y-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Appearance Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">Appearance</h2>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Theme</label>
            <div className="grid grid-cols-3 gap-3">
              {themes.map((theme) => (
                <button
                  key={theme.id}
                  onClick={() => updateSettings({ theme: theme.id })}
                  className={cn(
                    "flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all duration-300",
                    settings.theme === theme.id 
                      ? "border-primary bg-primary/10 text-primary scale-105 shadow-lg ring-2 ring-primary/20" 
                      : "border-transparent bg-muted/50 hover:bg-muted"
                  )}
                >
                  <div className={cn("w-10 h-10 rounded-full shadow-sm border-2 border-border", theme.color)} />
                  <span className={cn("text-[10px] font-bold uppercase tracking-tighter", settings.theme === theme.id ? "text-primary" : "text-muted-foreground")}>{theme.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Font Size</label>
            <div className="flex gap-2">
              {fontSizes.map((size) => (
                <button
                  key={size.id}
                  onClick={() => updateSettings({ fontSize: size.id })}
                  className={cn(
                    "flex-1 py-3 rounded-xl border-2 transition-all duration-300 text-xs font-bold uppercase tracking-widest",
                    settings.fontSize === size.id ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "border-border bg-card text-muted-foreground hover:bg-muted"
                  )}
                >
                  {size.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Schedule Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">Schedule</h2>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Time Interval</label>
          <div className="grid grid-cols-3 gap-2">
            {[60, 30, 15, 10, 5].map((interval) => (
              <button
                key={interval}
                onClick={() => updateSettings({ scheduleInterval: interval as ScheduleIntervalType })}
                className={cn(
                  "py-3 rounded-xl border-2 transition-all duration-300 text-xs font-bold uppercase tracking-widest",
                  settings.scheduleInterval === interval ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "border-border bg-card text-muted-foreground hover:bg-muted"
                )}
              >
                {interval === 60 ? '1 Hour' : `${interval} Min`}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Routine Streaks Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">Routine Streaks</h2>
        </div>

        <p className="text-[10px] text-muted-foreground leading-relaxed px-1">
          Turn on a streak for any routine you want to keep up. Each day you finish every step of that routine the streak goes up by one, it only counts once per day.
        </p>

        {routines.length === 0 ? (
          <div className="p-4 rounded-2xl bg-card border border-border shadow-sm">
            <p className="text-xs text-muted-foreground">Create a routine first, then come back here to track its streak.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {routines.map((routine) => (
              <div key={routine.id} className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-card border border-border shadow-sm">
                <div className="min-w-0 space-y-0.5">
                  <h3 className="text-sm font-bold truncate">{routine.name}</h3>
                  <p className="text-[10px] text-muted-foreground">
                    {routine.streakEnabled
                      ? `${currentStreak(routine)} day streak${routine.bestStreak ? ` \u00b7 best ${routine.bestStreak}` : ''}`
                      : 'Streak off'}
                  </p>
                </div>
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <div className="flex w-full justify-between px-1 text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">
                    <span>Off</span>
                    <span>On</span>
                  </div>
                  <button
                    onClick={() => toggleStreak(routine)}
                    aria-pressed={!!routine.streakEnabled}
                    aria-label={`Track streak for ${routine.name}`}
                    className={cn(
                      "w-12 h-6 rounded-full transition-all duration-300 relative",
                      routine.streakEnabled ? "bg-primary" : "bg-muted"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 rounded-full bg-card transition-all duration-300",
                      routine.streakEnabled ? "left-7" : "left-1"
                    )} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Features Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-2">
          <Layout className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">Features</h2>
        </div>

        <div className="flex items-center justify-between p-4 rounded-2xl bg-card border border-border shadow-sm">
          <div className="space-y-1">
            <h3 className="text-sm font-bold">Cycle Tracking</h3>
            <p className="text-[10px] text-muted-foreground">Show cycle tracking in Health section</p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="flex w-full justify-between px-1 text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">
              <span>Off</span>
              <span>On</span>
            </div>
            <button
              onClick={() => updateSettings({ showCycleTracking: !settings.showCycleTracking })}
              className={cn(
                "w-12 h-6 rounded-full transition-all duration-300 relative",
                settings.showCycleTracking ? "bg-primary" : "bg-muted"
              )}
            >
              <div className={cn(
                "absolute top-1 w-4 h-4 rounded-full bg-card transition-all duration-300",
                settings.showCycleTracking ? "left-7" : "left-1"
              )} />
            </button>
          </div>
        </div>
      </section>

      {/* AI Assistant Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">AI assistant</h2>
        </div>

        <SubscriptionPanel user={user?.uid} email={user?.email} />

        <div className="p-4 rounded-2xl bg-card border border-border shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-sm font-bold">Use the AI assistant</h3>
              <p className="text-[10px] text-muted-foreground">
                {settings.aiEnabled === false
                  ? 'Off. The coach uses its built-in replies and nothing leaves this device.'
                  : aiStatus?.enabled
                    ? `On. Messages are sent to ${aiStatus.defaultModel?.split(':')[0] || 'the provider'} to be answered.`
                    : 'No provider key is set, so the coach uses its built-in replies.'}
              </p>
            </div>
            <button
              onClick={() => updateSettings({ aiEnabled: settings.aiEnabled === false })}
              aria-pressed={settings.aiEnabled !== false}
              aria-label="Use the AI assistant"
              className={cn(
                "w-12 h-6 rounded-full transition-all duration-300 relative shrink-0",
                settings.aiEnabled !== false ? "bg-primary" : "bg-muted"
              )}
            >
              <div className={cn(
                "absolute top-1 w-4 h-4 rounded-full bg-card transition-all duration-300",
                settings.aiEnabled !== false ? "left-7" : "left-1"
              )} />
            </button>
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Provider</h3>
            <div className="grid grid-cols-2 gap-2">
              {([{ id: 'auto', label: 'Automatic' }, ...available.map((provider) => ({ id: provider.id, label: provider.label }))] as { id: AiProviderChoice; label: string }[]).map((option) => (
                <button
                  key={option.id}
                  onClick={() => updateSettings({ aiProvider: option.id })}
                  className={cn(
                    "py-2.5 rounded-xl border-2 text-[10px] font-bold uppercase tracking-widest transition-all",
                    selectedProvider === option.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {available.length === 0 && (
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                No provider is enabled on the server. Add a key (and for OpenAI, opt in with
                OPENAI_ENABLED) to turn the assistant on; the app keeps working without it.
              </p>
            )}
            {unavailable.length > 0 && (
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {unavailable
                  .map((provider) => `${provider.label}: ${provider.disabledReason || 'disabled'}`)
                  .join(' · ')}
              </p>
            )}
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Who is using the app</h3>
            <div className="grid grid-cols-3 gap-2">
              {ageBands.map((band) => (
                <button
                  key={band.id}
                  onClick={() => updateSettings({ aiAgeBand: band.id })}
                  title={band.hint}
                  className={cn(
                    "py-2.5 rounded-xl border-2 text-[10px] font-bold uppercase tracking-widest transition-all",
                    (settings.aiAgeBand || 'adult') === band.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  )}
                >
                  {band.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              This only changes the safety rules the assistant follows, it is not an age check and no
              birthday is stored.
            </p>
          </div>

          <div className="border-t border-border pt-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                Saved notes {facts.length > 0 ? `(${facts.length})` : ''}
              </h3>
              {facts.length > 0 && (
                <button onClick={emptyMemory} className="text-[10px] font-bold uppercase tracking-widest text-rose-600">
                  Clear all
                </button>
              )}
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h4 className="text-[11px] font-bold">Use saved notes</h4>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {memoryOn
                    ? 'Relevant notes are sent with a question so advice fits you. You can edit or remove any note below.'
                    : 'Off. Notes are neither sent nor saved, and asking me to remember something will be refused.'}
                </p>
              </div>
              <button
                onClick={() => updateSettings({ aiMemoryEnabled: !memoryOn })}
                aria-pressed={memoryOn}
                aria-label="Use saved notes"
                className={cn(
                  'w-12 h-6 rounded-full transition-all duration-300 relative shrink-0',
                  memoryOn ? 'bg-primary' : 'bg-muted'
                )}
              >
                <span
                  className={cn(
                    'absolute top-1 w-4 h-4 rounded-full bg-card transition-all duration-300',
                    memoryOn ? 'left-7' : 'left-1'
                  )}
                />
              </button>
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h4 className="text-[11px] font-bold">Save durable notes automatically</h4>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Off by default. When on, a sentence you say about your own preferences, goals or
                  routines can be saved as one short note. Conversations are never saved whole.
                </p>
              </div>
              <button
                onClick={() => updateSettings({ aiMemoryAutoSave: !settings.aiMemoryAutoSave })}
                aria-pressed={Boolean(settings.aiMemoryAutoSave)}
                aria-label="Save durable notes automatically"
                disabled={!memoryOn}
                className={cn(
                  'w-12 h-6 rounded-full transition-all duration-300 relative shrink-0',
                  settings.aiMemoryAutoSave && memoryOn ? 'bg-primary' : 'bg-muted',
                  !memoryOn && 'opacity-50'
                )}
              >
                <span
                  className={cn(
                    'absolute top-1 w-4 h-4 rounded-full bg-card transition-all duration-300',
                    settings.aiMemoryAutoSave && memoryOn ? 'left-7' : 'left-1'
                  )}
                />
              </button>
            </div>

            {memoryError && (
              <p className="text-[10px] leading-relaxed text-rose-600">{memoryError}</p>
            )}

            {facts.length === 0 ? (
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Nothing yet. Say "remember ..." in the coach, or add one below. Notes are encrypted
                with your account and only this account can read them.
              </p>
            ) : (
              <div className="space-y-1.5">
                {facts.map((fact) => (
                  <div key={fact.id} className="p-2 rounded-xl bg-muted/40 space-y-1.5">
                    {editingId === fact.id ? (
                      <div className="space-y-1.5">
                        <input
                          value={editText}
                          onChange={(event) => setEditText(event.target.value)}
                          aria-label="Edit saved note"
                          maxLength={200}
                          className="w-full px-2 py-1.5 rounded-lg bg-background border border-border text-[11px]"
                        />
                        <div className="flex flex-wrap items-center gap-1.5">
                          <select
                            value={editKind}
                            onChange={(event) => setEditKind(event.target.value as MemoryKind)}
                            aria-label="Note kind"
                            className="px-2 py-1 rounded-lg bg-background border border-border text-[10px]"
                          >
                            {MEMORY_KINDS.map((kind) => (
                              <option key={kind.id} value={kind.id}>{kind.label}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => void saveEdit()}
                            className="text-[9px] font-bold uppercase tracking-widest text-primary"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] leading-relaxed text-foreground">{fact.text}</p>
                          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70 mt-0.5">
                            {isMemoryKind(fact.kind) ? fact.kind : 'note'}
                            {fact.source === 'auto' ? ' · saved automatically' : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => beginEdit(fact)}
                          aria-label={`Edit ${fact.text}`}
                          className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary shrink-0"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeFact(fact.id)}
                          aria-label={`Forget ${fact.text}`}
                          className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground hover:text-rose-600 shrink-0"
                        >
                          Forget
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <input
                value={newFact}
                onChange={(event) => setNewFact(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addFact();
                }}
                placeholder="Add a note, for example: I prefer morning workouts"
                aria-label="Add a saved note"
                maxLength={200}
                disabled={!memoryOn}
                className="flex-1 min-w-[180px] px-3 py-2 rounded-xl bg-background border border-border text-[11px] disabled:opacity-50"
              />
              <select
                value={newKind}
                onChange={(event) => setNewKind(event.target.value as MemoryKind)}
                aria-label="New note kind"
                disabled={!memoryOn}
                className="px-2 py-2 rounded-xl bg-background border border-border text-[10px] disabled:opacity-50"
              >
                {MEMORY_KINDS.map((kind) => (
                  <option key={kind.id} value={kind.id}>{kind.label}</option>
                ))}
              </select>
              <button
                onClick={() => void addFact()}
                disabled={!memoryOn || newFact.trim().length < 3}
                className="px-3 py-2 rounded-xl bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-widest disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>

          <div className="border-t border-border pt-3 space-y-1">
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {aiStatus
                ? `This device: ${aiStatus.usage.today.requests} of ${aiStatus.limits.requestsPerDay} messages today. All users: $${aiStatus.usage.thisMonth.costUsd.toFixed(2)} of $${aiStatus.limits.costPerMonthUsd.toFixed(2)} this month.`
                : 'Usage figures appear once the server answers.'}
            </p>
            {aiStatus?.user && aiStatus.userLimits && (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Your share: {aiStatus.user.today.requests} of {aiStatus.userLimits.requestsPerDay}{' '}
                messages today · ${aiStatus.user.thisMonth.costUsd.toFixed(2)} of ${' '}
                {aiStatus.userLimits.costPerMonthUsd.toFixed(2)} this month.
              </p>
            )}
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {aiStatus?.cache?.enabled
                ? `Repeat questions can be answered from a short-lived cache (${Math.round((aiStatus.cache.ttlSeconds || 0) / 60)} minutes) so they cost nothing.`
                : 'The reply cache is off, so every question is sent to the provider.'}
            </p>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Running the assistant? The{' '}
              <Link to="/admin/ai" className="text-primary underline underline-offset-4">
                AI management dashboard
              </Link>{' '}
              is for administrators and lists providers, usage, costs and safety counts, never
              conversations.
            </p>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              The server keeps no copy of your prompts or replies. The opt-in AI provider receives the
              message and the snapshot described in the{' '}
              <Link to="/privacy" className="text-primary underline underline-offset-4">
                privacy policy
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* Account Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">Account</h2>
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border shadow-sm space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-black text-sm uppercase">
              {user?.displayName ? user.displayName.charAt(0) : 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold truncate text-foreground">
                {user?.displayName || 'Your space'}
              </h3>
              <p className="text-[10px] text-muted-foreground truncate">
                {user?.email || 'locked'}
              </p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-[8px] font-black uppercase bg-primary/10 text-primary px-1.5 py-0.5 rounded tracking-wider flex items-center gap-1">
                  <Smartphone className="w-2.5 h-2.5" /> Verified account
                </span>
                <span className="text-[8px] font-black uppercase bg-emerald-100  text-emerald-600  px-1.5 py-0.5 rounded tracking-wider flex items-center gap-1">
                  <ShieldCheck className="w-2.5 h-2.5" /> Encrypted
                </span>
              </div>
            </div>
          </div>

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Your account verifies AI access on the server. Everything you write is still scrambled
            with your journal password before it is saved and never leaves this browser. Signing out
            locks the journal again; anyone opening it has to know that password to read a single
            entry. Your account password and journal password are separate: resetting the account
            password does not re-encrypt or recover an existing local journal.
          </p>

          <div className="border-t border-border pt-2 space-y-1">
            <Link to="/about" className="w-full flex items-center justify-between py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-muted-foreground" />
                <span>About Serene Structure</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </Link>
            
            <button
              onClick={() => signOut()}
              disabled={authLoading}
              className="w-full flex items-center justify-between py-2 text-rose-600  font-bold text-xs"
            >
              <div className="flex items-center gap-2">
                <LogOut className="w-4 h-4" />
                <span>{authLoading ? 'Locking...' : 'Lock & sign out'}</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* Terms and privacy */}
      <section className="space-y-4" id="terms">
        <div className="flex items-center gap-2">
          <Info className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">Terms and privacy</h2>
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border space-y-4">
          <div className="space-y-1.5">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Privacy policy</h3>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Everything you write in Serene Structure is encrypted on this device with a key derived
              from your password and saved in this browser's local storage. Nothing is uploaded, no
              analytics or advertising code runs in the app, and no third party receives your entries,
              your name or your email. There is no server that could read them even if asked.
            </p>
          </div>

          <div className="border-t border-border pt-3 space-y-1.5">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">What is kept where</h3>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Entries live in this browser profile only. Clearing site data, using private browsing, or
              switching browsers removes your access to them. Recordings made with the microphone are
              turned into text on the device and are not stored as audio.
            </p>
          </div>

          <div className="border-t border-border pt-3 space-y-1.5">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Terms of use</h3>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              This app is a personal organisation and wellbeing tool, not medical, dietary, mental health
              or financial advice. Calorie, cycle and budget figures are estimates you enter or that are
              calculated from your entries. You are responsible for the device and browser that hold your
              data, and because the encryption key comes only from your password, a forgotten password
              cannot be reset and the entries cannot be recovered. Use the app as it is, at your own risk.
            </p>
          </div>

          <div className="border-t border-border pt-3 space-y-1.5">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Your controls</h3>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Lock and sign out to close the vault on this device. To remove the stored entries entirely,
              clear this site's data in your browser settings.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
              <Link to="/privacy" className="text-[10px] font-bold uppercase tracking-wider text-primary underline underline-offset-4">Privacy policy</Link>
              <Link to="/terms" className="text-[10px] font-bold uppercase tracking-wider text-primary underline underline-offset-4">Terms of use</Link>
              <Link to="/cookies" className="text-[10px] font-bold uppercase tracking-wider text-primary underline underline-offset-4">Cookies</Link>
            </div>
          </div>
        </div>
      </section>

      <div className="text-center pt-8">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">Version 1.0.0</p>
      </div>
    </div>
  );
};

export default Settings;
