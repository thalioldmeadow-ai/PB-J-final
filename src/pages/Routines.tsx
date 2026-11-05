import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Plus, X, SkipForward, SkipBack, Pause, Clock, Trash2, Check, RefreshCw, Lightbulb, GripVertical, Flame } from '../components/icons';
import { cn } from '../lib/utils';
import { useAuth } from '../components/AuthProvider';
import { storage } from '../lib/storage';
import { Goal, Routine, RoutineStep } from '../types';
import AiAssist from '../components/AiAssist';
import { loadHabitFacts } from '../lib/aiFacts';
import confetti from 'canvas-confetti';

const DING_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

const todayKey = () => new Date().toISOString().split('T')[0];
const yesterdayKey = () => new Date(Date.now() - 86400000).toISOString().split('T')[0];

/** Current streak, ignoring runs that were broken by a missed day. */
const activeStreak = (routine: Pick<Routine, 'streak' | 'lastCompletedDate'>) => {
  const last = routine.lastCompletedDate;
  if (!last || (last !== todayKey() && last !== yesterdayKey())) return 0;
  return routine.streak || 0;
};

const Routines: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [activeRoutine, setActiveRoutine] = useState<Routine | null>(null);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [steps, setSteps] = useState<RoutineStep[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);

  const dragRef = useRef<{ id: string; startIndex: number; startY: number; stepSize: number } | null>(null);

  useEffect(() => {
    const unsub = storage.subscribe(storage.key.ROUTINES, (data) => {
      const docs = data as Routine[];
      // Sort in memory to avoid index issues
      docs.sort((a, b) => (a.order || 0) - (b.order || 0));
      setRoutines(docs);
    });

    const unsubGoals = storage.subscribe(storage.key.GOALS, (data) => {
      setGoals(data as Goal[]);
    });

    return () => {
      unsub();
      unsubGoals();
    };
  }, []);

  const toggleGoalStep = async (goal: Goal, stepId: string) => {
    const steps = (goal.steps || []).map((step) =>
      step.id === stepId ? { ...step, completed: !step.completed } : step
    );
    const done = steps.filter((step) => step.completed).length;
    try {
      await storage.update(storage.key.GOALS, goal.id, {
        steps,
        progress: steps.length > 0 ? Math.round((done / steps.length) * 100) : 0,
      });
    } catch (error) {
      console.error('Error updating goal step:', error);
    }
  };

  const recordStreak = async (routineId: string) => {
    const routine = routines.find(r => r.id === routineId);
    if (!routine || !routine.streakEnabled) return;
    const today = todayKey();
    if (routine.lastCompletedDate === today) return;

    const streak = routine.lastCompletedDate === yesterdayKey() ? (routine.streak || 0) + 1 : 1;
    try {
      await storage.update(storage.key.ROUTINES, routineId, {
        streak,
        bestStreak: Math.max(streak, routine.bestStreak || 0),
        lastCompletedDate: today,
      });
    } catch (error) {
      console.error('Error recording routine streak:', error);
    }
  };

  useEffect(() => {
    let interval: any;
    if (!isPaused && timeLeft > 0 && activeRoutine && activeStepId) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && !isPaused && activeRoutine && activeStepId) {
      const currentIndex = steps.findIndex(s => s.id === activeStepId);
      if (currentIndex < steps.length - 1) {
        const nextStep = steps[currentIndex + 1];
        setActiveStepId(nextStep.id);
        setTimeLeft(nextStep.duration || 0);
      } else {
        // Finished the last step on the clock
        const finishedId = activeStepId;
        setSteps(prev => prev.map(s => s.id === finishedId ? { ...s, completed: true } : s));
        setIsPaused(true);
        triggerCelebration();
        void recordStreak(activeRoutine.id);
      }
    }
    return () => clearInterval(interval);
  }, [isPaused, timeLeft, activeRoutine, activeStepId, steps]);

  const startRoutine = (routine: Routine) => {
    if (!routine.steps || routine.steps.length === 0) return;
    const initialSteps = routine.steps.map(s => ({ ...s, completed: false }));
    setActiveRoutine(routine);
    setSteps(initialSteps);
    setActiveStepId(initialSteps[0].id);
    setTimeLeft(initialSteps[0].duration || 0);
    setIsPaused(false);
  };

  const closeRoutine = () => {
    setActiveRoutine(null);
    setActiveStepId(null);
    setSteps([]);
  };

  const deleteRoutine = async (id: string) => {
    try {
      await storage.delete(storage.key.ROUTINES, id);
    } catch (error) {
      console.error('Error deleting routine:', error);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const playDing = () => {
    const audio = new Audio(DING_SOUND_URL);
    audio.play().catch(() => {});
  };

  const triggerCelebration = () => {
    playDing();
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#8C916C', '#C89B9B', '#A8B5A8', '#D1B3C4', '#D9C5B2']
    });
  };

  const addTime = (seconds: number) => {
    if (!activeStepId) return;
    setSteps(prev => prev.map(s => s.id === activeStepId ? { ...s, duration: (s.duration || 0) + seconds } : s));
    setTimeLeft(prev => prev + seconds);
    setIsPaused(false);
  };

  const toggleStep = (id: string) => {
    const idx = steps.findIndex(s => s.id === id);
    if (idx === -1) return;

    const wasCompleted = steps[idx].completed;
    const newSteps = steps.map(s => s.id === id ? { ...s, completed: !wasCompleted } : s);
    setSteps(newSteps);

    if (!wasCompleted) {
      // If we completed the current active step, move to next
      if (id === activeStepId) {
        if (idx < newSteps.length - 1) {
          const nextStep = newSteps[idx + 1];
          setActiveStepId(nextStep.id);
          setTimeLeft(nextStep.duration || 0);
        } else {
          setIsPaused(true);
        }
      }

      if (newSteps.every(s => s.completed)) {
        setIsPaused(true);
        triggerCelebration();
        if (activeRoutine) void recordStreak(activeRoutine.id);
      } else {
        playDing();
      }
    }
  };

  const finishRoutine = () => {
    triggerCelebration();
    if (activeRoutine) void recordStreak(activeRoutine.id);
    setActiveRoutine(null);
    setActiveStepId(null);
    setSteps([]);
    navigate('/');
  };

  // ---- Drag to reorder steps in the running timer ----
  const beginDrag = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    const card = e.currentTarget.closest('[data-step-id]') as HTMLElement | null;
    const stepSize = (card?.getBoundingClientRect().height || 64) + 8;
    const step = steps[index];
    if (!step) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture can fail for synthetic or already-released pointers
    }
    dragRef.current = { id: step.id, startIndex: index, startY: e.clientY, stepSize };
    setDragId(step.id);
  };

  const moveDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const shift = Math.round((e.clientY - drag.startY) / drag.stepSize);
    const target = Math.max(0, Math.min(steps.length - 1, drag.startIndex + shift));
    setSteps(prev => {
      const from = prev.findIndex(s => s.id === drag.id);
      if (from < 0 || from === target) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragId(null);
  };

  const currentStep = steps.find(s => s.id === activeStepId) || steps[0];
  const currentStepIndex = steps.findIndex(s => s.id === activeStepId);
  const allDone = steps.length > 0 && steps.every(s => s.completed);
  const doneCount = steps.filter(s => s.completed).length;

  const timerOverlay = activeRoutine && currentStep && typeof document !== 'undefined'
    ? createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed inset-0 z-[300] text-foreground flex flex-col w-full max-w-md mx-auto shadow-2xl"
            style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
          >
            <div
              className="px-6 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4 flex justify-between items-center border-b border-border flex-shrink-0"
              style={{ backgroundColor: 'var(--background)' }}
            >
              <div className="space-y-1 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary truncate block">{activeRoutine.name}</span>
                <h2 className="text-xl font-bold tracking-tight">
                  {allDone ? 'All steps complete' : `Step ${Math.max(currentStepIndex, 0) + 1} of ${steps.length}`}
                </h2>
              </div>
              <button onClick={closeRoutine} className="p-3 rounded-full hover:bg-muted transition-all flex-shrink-0" aria-label="Close timer">
                <X className="w-6 h-6 text-foreground" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-6 space-y-8">
              {/* Timer Display */}
              <div className="flex flex-col items-center justify-center gap-6">
                <motion.div
                  key={activeStepId}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center space-y-1"
                >
                  <h3 className="text-3xl font-bold tracking-tighter">{currentStep.title}</h3>
                  <p className="text-sm text-muted-foreground font-medium">{currentStep.subtitle}</p>
                </motion.div>

                <div className="relative w-56 h-56 flex items-center justify-center flex-shrink-0">
                  <svg viewBox="0 0 256 256" className="absolute inset-0 w-full h-full -rotate-90">
                    <circle
                      cx="128"
                      cy="128"
                      r="120"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      className="text-muted/20"
                    />
                    <circle
                      cx="128"
                      cy="128"
                      r="120"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      strokeDasharray="754"
                      strokeDashoffset={754 * (1 - Math.min(1, timeLeft / (currentStep.duration || 1)))}
                      strokeLinecap="round"
                      className="text-primary transition-all duration-500"
                    />
                  </svg>
                  <div className="text-5xl font-black tracking-tighter tabular-nums">
                    {formatTime(Math.max(0, timeLeft))}
                  </div>
                </div>

                <div className="flex items-center gap-8">
                  <button
                    disabled={currentStepIndex <= 0}
                    onClick={() => {
                      const prevStep = steps[currentStepIndex - 1];
                      if (!prevStep) return;
                      setActiveStepId(prevStep.id);
                      setTimeLeft(prevStep.duration || 0);
                    }}
                    className="p-4 rounded-full border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-all"
                    aria-label="Previous step"
                  >
                    <SkipBack className="w-6 h-6" />
                  </button>
                  <button
                    onClick={() => setIsPaused(!isPaused)}
                    className="p-6 rounded-full text-primary-foreground shadow-xl shadow-primary/20 transition-all"
                    style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    aria-label={isPaused ? 'Resume timer' : 'Pause timer'}
                  >
                    {isPaused ? <Play className="w-8 h-8 fill-current" /> : <Pause className="w-8 h-8 fill-current" />}
                  </button>
                  <button
                    onClick={() => toggleStep(currentStep.id)}
                    className={cn(
                      "p-4 rounded-full border transition-all",
                      currentStep.completed
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:text-green-600 hover:border-green-500/50"
                    )}
                    aria-label="Mark step complete"
                  >
                    <Check className="w-6 h-6" />
                  </button>
                  <button
                    disabled={currentStepIndex >= steps.length - 1}
                    onClick={() => {
                      const nextStep = steps[currentStepIndex + 1];
                      if (!nextStep) return;
                      setActiveStepId(nextStep.id);
                      setTimeLeft(nextStep.duration || 0);
                    }}
                    className="p-4 rounded-full border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-all"
                    aria-label="Skip to next step"
                  >
                    <SkipForward className="w-6 h-6" />
                  </button>
                </div>

                {/* Add time */}
                <div className="flex items-center justify-center gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Add time</span>
                  {[60, 300].map((secs) => (
                    <button
                      key={secs}
                      onClick={() => addTime(secs)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-border text-[10px] font-black uppercase tracking-wider text-foreground hover:border-primary/50 hover:text-primary transition-all"
                      style={{ backgroundColor: 'var(--card)' }}
                    >
                      <Plus className="w-3 h-3" />
                      {secs / 60} min
                    </button>
                  ))}
                </div>
              </div>

              {/* Steps Queue */}
              <div className="space-y-3 pb-4">
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Queue</h4>
                  <span className="text-[10px] font-black text-primary/60">{doneCount}/{steps.length} done</span>
                </div>

                <div className="space-y-2">
                  {steps.map((step, idx) => (
                    <div
                      key={step.id}
                      data-step-id={step.id}
                      style={{ backgroundColor: 'var(--card)' }}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-2xl border-2 transition-all",
                        step.id === activeStepId ? "border-primary bg-primary/5 shadow-md" : "border-border/50",
                        step.completed && !dragId && "opacity-50",
                        dragId === step.id && "border-primary shadow-xl scale-[1.02] z-10 opacity-100"
                      )}
                    >
                      <button
                        onPointerDown={(e) => beginDrag(e, idx)}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        className="p-1.5 -ml-1 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-muted active:cursor-grabbing cursor-grab touch-none flex-shrink-0"
                        aria-label={`Drag ${step.title} to reorder`}
                        title="Drag to reorder"
                      >
                        <GripVertical className="w-4 h-4" />
                      </button>

                      <span className="text-[10px] font-black text-muted-foreground/40 w-4 flex-shrink-0">{idx + 1}</span>

                      <div className="flex-1 min-w-0">
                        <p className={cn("text-xs font-black tracking-tight truncate", step.completed && "line-through")}>{step.title}</p>
                        <p className="flex items-center gap-1 text-[9px] font-bold uppercase text-muted-foreground/70">
                          <Clock className="w-2.5 h-2.5" />
                          {formatTime(step.duration || 0)}
                        </p>
                      </div>

                      <button
                        onClick={() => toggleStep(step.id)}
                        className={cn(
                          "w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all shadow-sm flex-shrink-0",
                          step.completed ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary/40"
                        )}
                        style={step.completed ? { backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' } : { backgroundColor: 'var(--background)' }}
                        aria-label={step.completed ? `Mark ${step.title} incomplete` : `Mark ${step.title} complete`}
                      >
                        {step.completed ? <Check className="w-4 h-4 stroke-[3]" /> : <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20" />}
                      </button>
                    </div>
                  ))}
                </div>

                <p className="text-[9px] text-center text-muted-foreground/60 uppercase tracking-widest pt-1">
                  Drag the handle to reorder steps
                </p>
              </div>
            </div>

            {allDone && (
              <div
                className="px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-border flex-shrink-0"
                style={{ backgroundColor: 'var(--background)' }}
              >
                <button
                  onClick={finishRoutine}
                  className="w-full py-4 rounded-2xl text-primary-foreground font-black text-xs uppercase tracking-widest shadow-lg shadow-primary/25 transition-all flex items-center justify-center gap-2"
                  style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  Done, back to home
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>,
        document.body
      )
    : null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold tracking-tight">Your Routines</h2>
        <Link
          to="/create-routine"
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          New
        </Link>
      </div>

      <AiAssist
        title="Build a habit"
        description="Uses your routines and recorded streaks. Suggestions are small on purpose, and a new routine is only added after you confirm."
        mode="habits"
        allowActions={['addHabit']}
        suggestions={[
          { label: 'Suggest a habit', prompt: 'Suggest one small habit that would fit my current routines.' },
          { label: 'Review my streaks', prompt: 'How are my routines going, based on the recorded streaks?' },
          { label: 'Make it easier', prompt: 'Which routine is too much, and how could I make it easier this week?' },
        ]}
        context={async () => ({ habits: await loadHabitFacts() })}
      />

      {goals.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Goals</h3>
          <div className="grid gap-3">
            {goals.map((goal) => {
              const steps = goal.steps || [];
              const done = steps.filter((step) => step.completed).length;
              const progress = steps.length > 0 ? Math.round((done / steps.length) * 100) : goal.progress || 0;
              return (
                <div key={goal.id} className="p-5 rounded-sm bg-card border border-border shadow-sm space-y-3">
                  <div className="flex justify-between items-center gap-3">
                    <p className="text-sm font-semibold truncate">{goal.title}</p>
                    <span className="text-[10px] font-bold text-primary tabular-nums">{progress}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary/60 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  {steps.length > 0 ? (
                    <div className="space-y-1">
                      {steps.map((step) => (
                        <button
                          key={step.id}
                          onClick={() => toggleGoalStep(goal, step.id)}
                          className="w-full flex items-center gap-2 text-left text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <span className={cn(
                            'w-3.5 h-3.5 rounded-full border flex-shrink-0',
                            step.completed ? 'bg-primary border-primary' : 'border-border'
                          )} />
                          <span className={cn('truncate', step.completed && 'line-through opacity-60')}>{step.title}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">{done} of {steps.length} steps done</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-4">
        {routines.map((routine, idx) => (
          <motion.div
            key={routine.id}
            whileHover={{ y: -2 }}
            className={cn(
              "group p-5 rounded-3xl border shadow-sm hover:shadow-md transition-all duration-300",
              idx % 4 === 0 ? "bg-moss/20 border-moss/30" : idx % 4 === 1 ? "bg-rose/20 border-rose/30" : idx % 4 === 2 ? "bg-sky/20 border-sky/30" : "bg-lavender/20 border-lavender/30"
            )}
          >
            <div className="flex justify-between items-center mb-4">
              <div className="space-y-1 min-w-0">
                <span className={cn(
                  "text-[10px] font-bold uppercase tracking-widest",
                  idx % 4 === 0 ? "text-moss-foreground" : idx % 4 === 1 ? "text-rose-foreground" : idx % 4 === 2 ? "text-sky-foreground" : "text-lavender-foreground"
                )}>{routine.type}</span>
                <h3 className="text-lg font-semibold tracking-tight truncate">{routine.name}</h3>
                {routine.streakEnabled && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-primary">
                    <Flame className="w-3 h-3" />
                    {activeStreak(routine) > 0 ? `${activeStreak(routine)} day streak` : 'Streak ready'}
                  </span>
                )}
              </div>
              <div className="flex gap-2 items-center">
                <button onClick={() => deleteRoutine(routine.id)} className="opacity-0 group-hover:opacity-100 p-2 text-red-500 hover:text-red-700 transition-all" aria-label={`Delete ${routine.name}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => startRoutine(routine)}
                  className={cn(
                    "p-3 rounded-full shadow-lg transition-all",
                    idx % 4 === 0 ? "bg-moss text-moss-foreground shadow-moss/20" : idx % 4 === 1 ? "bg-rose text-rose-foreground shadow-rose/20" : idx % 4 === 2 ? "bg-sky text-sky-foreground shadow-sky/20" : "bg-lavender text-lavender-foreground shadow-lavender/20"
                  )}
                  aria-label={`Start ${routine.name}`}
                >
                  <Play className="w-5 h-5 fill-current" />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {routine.steps && routine.steps.slice(0, 3).map((step) => (
                <div key={step.id} className="flex items-center gap-3 text-sm text-muted-foreground">
                  <div className="w-1.5 h-1.5 rounded-full bg-border" />
                  <span className="truncate">{step.title}</span>
                  <span className="text-[10px] opacity-50 ml-auto">{formatTime(step.duration || 0)}</span>
                </div>
              ))}
              {routine.steps && routine.steps.length > 3 && (
                <div className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-tighter pt-1">
                  + {routine.steps.length - 3} more steps
                </div>
              )}
            </div>
          </motion.div>
        ))}

        {routines.length === 0 && (
          <div className="py-20 text-center space-y-4">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto">
              <Plus className="w-8 h-8 text-muted-foreground/30" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-bold text-muted-foreground">No routines yet</p>
              <p className="text-xs text-muted-foreground/60">Create your first routine to stay on track.</p>
            </div>
            <Link
              to="/create-routine"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all"
            >
              <Plus className="w-4 h-4" />
              Create Routine
            </Link>
          </div>
        )}
      </div>

      {timerOverlay}

    </div>
  );
};

export default Routines;
