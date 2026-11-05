import React, { useState, useEffect, useLayoutEffect } from 'react';
import { NavLink, useLocation, Link } from 'react-router-dom';
import { 
  Home, List, Calendar, Book, Settings, Timer, User, Lightbulb, Heart, MessageSquare,
  X, Check, Plus
} from './icons';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import VoiceButton from './VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';
import { useAuth } from './AuthProvider';
import { storage } from '../lib/storage';
import {
  BUILT_IN_FACTORS,
  BUILT_IN_MOODS,
  createCustomFactor,
  createCustomMood,
  loadCustomFactors,
  loadCustomMoods,
  saveCustomFactor,
  saveCustomMood,
  subscribeMoodOptions,
  type FactorOption,
  type MoodOption,
} from '../lib/moodOptions';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const { user } = useAuth();

  // Route changes keep the previous page's scroll position because the app is
  // client-rendered. Start every tab at the top, before the new page paints.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
  }, [location.pathname]);

  // Mood pop-up state
  const [moodEntries, setMoodEntries] = useState<any[]>([]);
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [intensity, setIntensity] = useState(5);
  const [energy, setEnergy] = useState(5);
  const [selectedFactors, setSelectedFactors] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(true);
  const [customMoods, setCustomMoods] = useState<MoodOption[]>(loadCustomMoods);
  const [customFactors, setCustomFactors] = useState<FactorOption[]>(loadCustomFactors);
  const [showCustomMood, setShowCustomMood] = useState(false);
  const [customMoodLabel, setCustomMoodLabel] = useState('');
  const [saveCustomMoodForReuse, setSaveCustomMoodForReuse] = useState(true);
  const [showCustomFactor, setShowCustomFactor] = useState(false);
  const [customFactorLabel, setCustomFactorLabel] = useState('');
  const [saveCustomFactorForReuse, setSaveCustomFactorForReuse] = useState(true);

  const todayStr = new Date().toDateString();

  useEffect(() => {
    const unsub = storage.subscribe(storage.key.MOOD_ENTRIES, (data) => {
      setMoodEntries(data || []);
    }, user?.uid);
    return unsub;
  }, [user?.uid]);

  useEffect(() => {
    const isDismissed = localStorage.getItem('serene_last_mood_prompt_resolved') === todayStr;
    setPromptDismissed(isDismissed);
  }, [todayStr]);

  useEffect(() => subscribeMoodOptions(() => {
    const savedMoods = loadCustomMoods();
    const savedFactors = loadCustomFactors();
    setCustomMoods(prev => [
      ...savedMoods,
      ...prev.filter(option => !savedMoods.some(savedOption => savedOption.id === option.id)),
    ]);
    setCustomFactors(prev => [
      ...savedFactors,
      ...prev.filter(option => !savedFactors.some(savedOption => savedOption.id === option.id)),
    ]);
  }), []);

  const moods = [...BUILT_IN_MOODS, ...customMoods];
  const factors = [...BUILT_IN_FACTORS, ...customFactors];

  const alreadyTrackedToday = moodEntries.some(e => {
    try {
      return new Date(e.date).toDateString() === todayStr;
    } catch {
      return false;
    }
  });

  const showMoodPopup = !alreadyTrackedToday && !promptDismissed;

  const handleClose = () => {
    localStorage.setItem('serene_last_mood_prompt_resolved', todayStr);
    setPromptDismissed(true);
  };

  const toggleMood = (moodId: string) => {
    setSelectedMoods(prev =>
      prev.includes(moodId)
        ? prev.filter(id => id !== moodId)
        : [...prev, moodId]
    );
  };

  const toggleFactor = (factorId: string) => {
    setSelectedFactors(prev => 
      prev.includes(factorId) 
        ? prev.filter(id => id !== factorId) 
        : [...prev, factorId]
    );
  };

  const addCustomMood = () => {
    const label = customMoodLabel.trim();
    if (!label) return;

    const existing = moods.find(mood => mood.label.toLowerCase() === label.toLowerCase());
    if (existing) {
      setSelectedMoods(prev => prev.includes(existing.id) ? prev : [...prev, existing.id]);
      setCustomMoodLabel('');
      setShowCustomMood(false);
      return;
    }

    const option = saveCustomMoodForReuse ? saveCustomMood(label) : createCustomMood(label);
    if (!option) return;
    setCustomMoods(prev => prev.some(item => item.id === option.id) ? prev : [...prev, option]);
    setSelectedMoods(prev => [...prev, option.id]);
    setCustomMoodLabel('');
    setShowCustomMood(false);
  };

  const addCustomFactor = () => {
    const label = customFactorLabel.trim();
    if (!label) return;

    const existing = factors.find(factor => factor.label.toLowerCase() === label.toLowerCase());
    if (existing) {
      setSelectedFactors(prev => prev.includes(existing.id) ? prev : [...prev, existing.id]);
      setCustomFactorLabel('');
      setShowCustomFactor(false);
      return;
    }

    const option = saveCustomFactorForReuse ? saveCustomFactor(label) : createCustomFactor(label);
    if (!option) return;
    setCustomFactors(prev => prev.some(item => item.id === option.id) ? prev : [...prev, option]);
    setSelectedFactors(prev => [...prev, option.id]);
    setCustomFactorLabel('');
    setShowCustomFactor(false);
  };

  const handleSaveMood = async () => {
    if (selectedMoods.length === 0) return;
    setIsSubmitting(true);
    
    const primaryMood = selectedMoods[0];
    const moodLabels = Object.fromEntries(
      selectedMoods.map(id => [id, moods.find(option => option.id === id)?.label || id]),
    );
    const factorLabels = Object.fromEntries(
      selectedFactors.map(id => [id, factors.find(option => option.id === id)?.label || id]),
    );
    const moodEntry = {
      uid: user?.uid || 'guest',
      date: new Date().toISOString(),
      moodId: primaryMood,
      moodIds: selectedMoods,
      moodLabels,
      intensity,
      factors: selectedFactors,
      factorLabels,
      note,
      createdAt: new Date().toISOString(),
      energy,
    };

    try {
      await storage.add(storage.key.MOOD_ENTRIES, moodEntry);
      
      // Also save to journal if there's a note
      if (note.trim()) {
        const journalContent = `Mood Check-in: ${selectedMoods.map(id => moodLabels[id]).join(', ')} (${intensity}/10)\nEnergy Level: ${energy}/10\nFactors: ${selectedFactors.map(id => factorLabels[id]).join(', ')}\n\n${note}`;
        
        await storage.add(storage.key.JOURNAL_ENTRIES, {
          uid: user?.uid || 'guest',
          type: 'dump',
          content: journalContent,
          createdAt: new Date().toISOString(),
        });
      }

      localStorage.setItem('serene_last_mood_prompt_resolved', todayStr);
      setPromptDismissed(true);
      
      // Reset
      setSelectedMoods([]);
      setIntensity(5);
      setEnergy(5);
      setSelectedFactors([]);
      setNote('');
    } catch (error) {
      console.error('Error saving daily mood:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const navItems = [
    { icon: List, label: 'Lists', path: '/lists' },
    { icon: MessageSquare, label: 'Coach', path: '/ai-coach' },
    { icon: Heart, label: 'Health', path: '/health' },
    { icon: Home, label: 'Today', path: '/' },
    { icon: Calendar, label: 'Plan', path: '/plan' },
    { icon: Book, label: 'Journal', path: '/journal' },
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto bg-background text-foreground relative pb-20">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[300] focus:top-2 focus:left-2 focus:bg-card focus:text-foreground focus:border focus:border-primary focus:px-3 focus:py-2 focus:text-xs focus:font-bold">Skip to content</a>
      {/* Top Bar */}
      <header className="sticky top-0 z-[100] bg-background/80 px-6 py-4 flex justify-between items-center border-b border-border">
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </span>
          <h1 className="text-xl font-bold tracking-tight text-primary">Serene Structure</h1>
        </div>
        <div className="flex gap-3">
          <Link to="/routines" aria-label="Routines" className="p-2 rounded-full hover:bg-muted transition-colors">
            <Timer className="w-5 h-5 text-primary" />
          </Link>
          <Link to="/settings" aria-label="Settings and account" className="p-1 rounded-full hover:bg-muted transition-colors overflow-hidden">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-7 h-7 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <User className="w-5 h-5 text-muted-foreground" />
            )}
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main id="main" tabIndex={-1} className="flex-1 px-6 py-4 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-background/90 border-t border-border px-4 pt-3 pb-7 flex justify-around items-center z-20">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => cn(
                "flex flex-col items-center gap-1 p-2 rounded-2xl transition-all duration-300 relative",
                isActive ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("w-6 h-6", isActive && "scale-110")} />
              <span className="text-[10px] font-medium uppercase tracking-tighter">{item.label}</span>
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute -bottom-1 w-1 h-1 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* "You're doing enough" floating message - subtle */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 0.4 }}
        className="text-center py-12 text-sm italic text-muted-foreground pointer-events-none"
      >
        You're doing enough.
      </motion.div>

      {/* Daily Mood Check-In Pop-up */}
      <AnimatePresence>
        {showMoodPopup && (
          <div className="fixed inset-0 z-[250] bg-black/60 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", duration: 0.5 }}
              className="bg-card border border-border w-full max-w-sm rounded-sm p-5 shadow-2xl relative flex flex-col max-h-[85vh]"
            >
              <button
                onClick={handleClose}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-muted text-muted-foreground transition-all"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="text-center pb-3 border-b border-border mb-4">
                <div className="inline-flex p-2 rounded-full bg-primary/10 text-primary mb-1">
                  <Lightbulb className="w-5 h-5 text-primary" />
                </div>
                <h2 className="text-sm font-black uppercase tracking-widest text-[#8A7355]">Daily Mind Reset</h2>
                <h3 className="text-xs font-bold text-muted-foreground mt-0.5">How are you feeling today?</h3>
              </div>

              {/* Scrollable Body */}
              <div className="flex-1 overflow-y-auto pr-1 space-y-5 scrollbar-none pb-4">
                
                {/* Mood Selection Row */}
                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Select Moods (Tap multiple)</h4>
                  <div className="grid grid-cols-3 gap-1.5">
                    {moods.map((mood) => {
                      const isActive = selectedMoods.includes(mood.id);
                      const Icon = mood.icon;
                      return (
                        <button
                          key={mood.id}
                          type="button"
                          onClick={() => toggleMood(mood.id)}
                          className={cn(
                            "py-2 px-1 rounded-xl border text-[10px] font-bold flex flex-col items-center gap-1 transition-all",
                            isActive ? mood.activeColor : `${mood.color} border-border/40`
                          )}
                        >
                          <Icon className="w-4 h-4 mb-0.5" />
                          <span className="truncate max-w-full">{mood.label}</span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setShowCustomMood(prev => !prev)}
                      aria-expanded={showCustomMood}
                      className={cn(
                        "py-2 px-1 rounded-xl border border-dashed text-[10px] font-bold flex flex-col items-center gap-1 transition-all",
                        showCustomMood
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/60 text-muted-foreground hover:border-primary/50 hover:text-primary"
                      )}
                    >
                      <Plus className="w-4 h-4 mb-0.5" />
                      <span className="truncate max-w-full">Other</span>
                    </button>
                  </div>

                  {showCustomMood && (
                    <div className="rounded-xl border border-dashed border-border bg-secondary/20 p-2.5 space-y-2">
                      <input
                        value={customMoodLabel}
                        onChange={event => setCustomMoodLabel(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            addCustomMood();
                          }
                        }}
                        maxLength={32}
                        autoFocus
                        aria-label="Your own mood"
                        placeholder="Type your own mood"
                        className="w-full px-2.5 py-2 rounded-lg bg-card border border-border text-[11px] focus:outline-none focus:border-primary"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-1.5 text-[9px] text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={saveCustomMoodForReuse}
                            onChange={event => setSaveCustomMoodForReuse(event.target.checked)}
                            className="w-3.5 h-3.5 accent-primary"
                          />
                          Save for reuse
                        </label>
                        <button
                          type="button"
                          onClick={addCustomMood}
                          disabled={!customMoodLabel.trim()}
                          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[9px] font-black uppercase tracking-wider disabled:opacity-40"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Intensity Slider */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Rating</h4>
                    <span className="text-base font-black text-primary">{intensity}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    value={intensity}
                    onChange={(e) => setIntensity(parseInt(e.target.value))}
                    aria-label="Mood rating"
                    className="w-full h-1 bg-secondary rounded-full appearance-none cursor-pointer accent-primary"
                  />
                  <div className="flex justify-between text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                    <span>1 Minimal</span>
                    <span>10 Intense</span>
                  </div>
                </div>

                {/* Energy Slider */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Energy</h4>
                    <span className="text-base font-black text-primary">{energy}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    value={energy}
                    onChange={(e) => setEnergy(parseInt(e.target.value))}
                    className="w-full h-1 bg-secondary rounded-full appearance-none cursor-pointer accent-primary"
                  />
                </div>

                {/* Influencing Factors */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Influencing factors</h4>
                    <span className={cn(
                      "text-[9px] font-black uppercase tracking-wider transition-colors",
                      selectedFactors.length > 0 ? "text-primary" : "text-muted-foreground/50"
                    )}>
                      {selectedFactors.length > 0 ? `${selectedFactors.length} selected` : 'Tap to select'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {factors.map((factor) => {
                      const isSelected = selectedFactors.includes(factor.id);
                      const Icon = factor.icon;
                      return (
                        <button
                          key={factor.id}
                          type="button"
                          onClick={() => toggleFactor(factor.id)}
                          aria-pressed={isSelected}
                          className={cn(
                            "min-h-[40px] py-2 px-3 rounded-full text-[10px] font-black uppercase tracking-wider border transition-all flex items-center gap-1 ",
                            isSelected
                              ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/25"
                              : "bg-secondary text-muted-foreground border-border/40 hover:bg-secondary/80"
                          )}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {factor.label}
                          {isSelected && <Check className="w-3 h-3" />}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setShowCustomFactor(prev => !prev)}
                      aria-expanded={showCustomFactor}
                      className={cn(
                        "min-h-[40px] py-2 px-3 rounded-full text-[10px] font-black uppercase tracking-wider border border-dashed transition-all flex items-center gap-1",
                        showCustomFactor
                          ? "bg-primary/10 text-primary border-primary"
                          : "bg-secondary/50 text-muted-foreground border-border/40 hover:bg-secondary/80"
                      )}
                    >
                      <Plus className="w-3.5 h-3.5" /> Other
                    </button>
                  </div>

                  {showCustomFactor && (
                    <div className="rounded-xl border border-dashed border-border bg-secondary/20 p-2.5 space-y-2">
                      <input
                        value={customFactorLabel}
                        onChange={event => setCustomFactorLabel(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            addCustomFactor();
                          }
                        }}
                        maxLength={32}
                        aria-label="Your own influence"
                        placeholder="Type your own influence"
                        className="w-full px-2.5 py-2 rounded-lg bg-card border border-border text-[11px] focus:outline-none focus:border-primary"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-1.5 text-[9px] text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={saveCustomFactorForReuse}
                            onChange={event => setSaveCustomFactorForReuse(event.target.checked)}
                            className="w-3.5 h-3.5 accent-primary"
                          />
                          Save for reuse
                        </label>
                        <button
                          type="button"
                          onClick={addCustomFactor}
                          disabled={!customFactorLabel.trim()}
                          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[9px] font-black uppercase tracking-wider disabled:opacity-40"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Optional Note */}
                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quick Thoughts (Optional)</h4>
                  <div className="relative">
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Write a brief reflection..."
                      rows={2}
                      className="w-full p-3 pb-10 rounded-xl bg-card/30  border border-border/40 text-xs focus:ring-1 focus:ring-primary focus:outline-none placeholder:text-muted-foreground/35 resize-none leading-relaxed"
                    />
                    <VoiceButton
                      size="sm"
                      className="absolute bottom-2 right-2"
                      onTranscript={(text) => setNote(prev => appendDictation(prev, text))}
                      label="Dictate your reflection"
                    />
                  </div>
                </div>

              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-border flex flex-col gap-2 mt-2">
                <button
                  onClick={handleSaveMood}
                  disabled={selectedMoods.length === 0 || isSubmitting}
                  className="w-full py-3 bg-primary text-primary-foreground rounded-2xl text-xs font-black uppercase tracking-widest disabled:opacity-40 transition-all flex items-center justify-center gap-1 shadow-md "
                >
                  {isSubmitting ? 'Saving...' : 'Save Check-in'}
                </button>
                <button
                  onClick={handleClose}
                  className="w-full py-2.5 bg-transparent text-muted-foreground hover:text-foreground text-xs font-bold uppercase tracking-wider transition-all"
                >
                  Maybe Later
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Layout;
