import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Flame, ChevronDown, ChevronUp, Play, X, CheckCircle2, Info } from '../components/icons';
import { cn } from '../lib/utils';
import { CHALLENGES } from '../constants';
import { useAuth } from '../components/AuthProvider';
import { storage } from '../lib/storage';
import { Challenge } from '../types';

const Challenges: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [expandedChallengeId, setExpandedChallengeId] = useState<string | null>(null);
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null);

  useEffect(() => {
    const unsub = storage.subscribe(storage.key.ACTIVE_CHALLENGES, (data) => {
      const active = (data as Challenge[]).find(c => c.active);
      setActiveChallenge(active || null);
    });
    return () => unsub();
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedChallengeId(expandedChallengeId === id ? null : id);
  };

  const startChallenge = async (challengeId: string) => {
    // Deactivate current challenge if any
    if (activeChallenge) {
      await storage.update(storage.key.ACTIVE_CHALLENGES, activeChallenge.id, { active: false });
    }

    const challengeData = CHALLENGES.find(c => c.id === challengeId);
    if (!challengeData) return;

    try {
      await storage.add(storage.key.ACTIVE_CHALLENGES, {
        uid: user?.uid || 'guest',
        challengeId: challengeData.id,
        title: challengeData.title,
        description: challengeData.description,
        startDate: new Date().toISOString(),
        completedDays: [],
        active: true
      });
      navigate('/');
    } catch (error) {
      console.error('Error starting challenge:', error);
    }
  };

  const stopChallenge = async () => {
    if (!activeChallenge) return;
    try {
      await storage.update(storage.key.ACTIVE_CHALLENGES, activeChallenge.id, { active: false });
    } catch (error) {
      console.error('Error stopping challenge:', error);
    }
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold tracking-tight">30-Day Challenges</h2>
        <div className="p-2 rounded-full bg-primary/10 text-primary">
          <Flame className="w-5 h-5" />
        </div>
      </div>

      <div className="space-y-4">
        {CHALLENGES.map((challenge, idx) => {
          const isExpanded = expandedChallengeId === challenge.id;
          const isActive = activeChallenge?.challengeId === challenge.id;
          const colors = [
            "bg-moss/20 border-moss/30 text-moss-foreground",
            "bg-rose/20 border-rose/30 text-rose-foreground",
            "bg-sky/20 border-sky/30 text-sky-foreground",
            "bg-lavender/20 border-lavender/30 text-lavender-foreground"
          ];
          const colorClass = colors[idx % colors.length];

          return (
            <motion.div
              key={challenge.id}
              className={cn(
                "overflow-hidden rounded-3xl border transition-all duration-300",
                isActive ? "border-primary bg-primary/10 shadow-md" : cn("bg-card shadow-sm", colorClass.split(' ')[0], colorClass.split(' ')[1])
              )}
            >
              <div className="p-5 flex justify-between items-center cursor-pointer" onClick={() => toggleExpand(challenge.id)}>
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "p-3 rounded-2xl transition-colors",
                    isActive ? "bg-primary text-primary-foreground" : colorClass.split(' ')[0]
                  )}>
                    <Flame className="w-5 h-5" />
                  </div>
                  <div className="space-y-0.5">
                    <h3 className="font-semibold tracking-tight">{challenge.title}</h3>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">30 Days</p>
                  </div>
                </div>
                {isExpanded ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
              </div>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="px-5 pb-5 space-y-6"
                  >
                    <div className="pt-2">
                      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                        {challenge.description}
                      </p>
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Daily Breakdown</h4>
                      <div className="max-h-96 overflow-y-auto space-y-2 pr-2 scrollbar-hide">
                        {challenge.days.map((day) => (
                          <div key={day.dayNumber} className="flex items-start gap-3 p-3 rounded-xl bg-accent/10 text-xs">
                            <span className="font-bold text-accent-foreground">Day {day.dayNumber}</span>
                            <span className="text-muted-foreground">{day.task}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-2">
                      {isActive ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); stopChallenge(); }}
                          className="w-full py-4 rounded-2xl bg-red-50 text-red-500 font-bold text-xs uppercase tracking-widest hover:bg-red-100 transition-all flex items-center justify-center gap-2"
                        >
                          <X className="w-4 h-4" />
                          Stop Challenge
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); startChallenge(challenge.id); }}
                          className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2"
                        >
                          <Play className="w-4 h-4 fill-current" />
                          Start Challenge
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default Challenges;
