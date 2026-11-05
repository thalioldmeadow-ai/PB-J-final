import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Send, ChevronLeft, ChevronRight, History, Loader2, Check, Plus } from '../components/icons';
import { cn } from '../lib/utils';
import VoiceButton from '../components/VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';
import { useAuth } from '../components/AuthProvider';
import { storage } from '../lib/storage';
import { MoodEntry, JournalEntry } from '../types';
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
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns';

const Mood: React.FC = () => {
  const { user } = useAuth();
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [intensity, setIntensity] = useState(5);
  const [energy, setEnergy] = useState(5);
  const [selectedFactors, setSelectedFactors] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [entries, setEntries] = useState<MoodEntry[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customMoods, setCustomMoods] = useState<MoodOption[]>(loadCustomMoods);
  const [customFactors, setCustomFactors] = useState<FactorOption[]>(loadCustomFactors);
  const [showCustomMood, setShowCustomMood] = useState(false);
  const [customMoodLabel, setCustomMoodLabel] = useState('');
  const [saveCustomMoodForReuse, setSaveCustomMoodForReuse] = useState(true);
  const [showCustomFactor, setShowCustomFactor] = useState(false);
  const [customFactorLabel, setCustomFactorLabel] = useState('');
  const [saveCustomFactorForReuse, setSaveCustomFactorForReuse] = useState(true);

  useEffect(() => {
    const unsubMood = storage.subscribe(storage.key.MOOD_ENTRIES, (data) => {
      setEntries(data as MoodEntry[]);
    });
    return () => unsubMood();
  }, []);

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

  const handleSave = async () => {
    if (selectedMoods.length === 0) return;
    setIsSubmitting(true);
    
    const primaryMood = selectedMoods[0];
    const moodLabels = Object.fromEntries(
      selectedMoods.map(id => [id, moods.find(option => option.id === id)?.label || id]),
    );
    const factorLabels = Object.fromEntries(
      selectedFactors.map(id => [id, factors.find(option => option.id === id)?.label || id]),
    );
    const moodEntry: Omit<MoodEntry, 'id'> = {
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
        const journalContent = `Moods: ${selectedMoods.map(id => moodLabels[id]).join(', ')} (${intensity}/10)\nEnergy Level: ${energy}/10\nFactors: ${selectedFactors.map(id => factorLabels[id]).join(', ')}\n\n${note}`;
        
        await storage.add(storage.key.JOURNAL_ENTRIES, {
          uid: user?.uid || 'guest',
          type: 'dump',
          content: journalContent,
          createdAt: new Date().toISOString(),
        } as Omit<JournalEntry, 'id'>);
      }

      // Reset form
      setSelectedMoods([]);
      setIntensity(5);
      setEnergy(5);
      setSelectedFactors([]);
      setNote('');
    } catch (error) {
      console.error('Error saving mood:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  return (
    <div className="space-y-12 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="space-y-2">
        <h1 className="text-3xl font-black tracking-tighter">Mood & Energy</h1>
        <p className="text-muted-foreground font-medium">How are you feeling in this moment?</p>
      </header>

      {/* Mood Palette */}
      <section className="space-y-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Mood Palette (Select multiple)</h2>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          {moods.map((mood) => {
            const Icon = mood.icon;
            const isActive = selectedMoods.includes(mood.id);
            return (
              <motion.button
                key={mood.id}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => toggleMood(mood.id)}
                className={cn(
                  "p-4 rounded-sm border-2 transition-all flex flex-col items-center gap-2 group",
                  isActive ? mood.activeColor : mood.color,
                  !isActive && "hover:border-primary/50"
                )}
              >
                <Icon className={cn("w-6 h-6 mb-1", isActive ? "text-primary-foreground" : "group- transition-transform")} />
                <span className="text-[10px] font-bold uppercase tracking-tight">{mood.label}</span>
              </motion.button>
            );
          })}
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowCustomMood(prev => !prev)}
            aria-expanded={showCustomMood}
            className={cn(
              "p-4 rounded-sm border-2 border-dashed transition-all flex flex-col items-center gap-2",
              showCustomMood
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-primary"
            )}
          >
            <Plus className="w-6 h-6 mb-1" />
            <span className="text-[10px] font-bold uppercase tracking-tight">Other</span>
          </motion.button>
        </div>

        {showCustomMood && (
          <div className="rounded-sm border-2 border-dashed border-border bg-card p-4 space-y-3">
            <div>
              <label htmlFor="custom-mood" className="text-xs font-bold">Your own mood</label>
              <p className="text-[10px] text-muted-foreground mt-0.5">Type a word or short phrase.</p>
            </div>
            <div className="flex gap-2">
              <input
                id="custom-mood"
                value={customMoodLabel}
                onChange={event => setCustomMoodLabel(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addCustomMood();
                  }
                }}
                maxLength={32}
                placeholder="e.g. Hopeful"
                className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-secondary/40 border border-border text-sm focus:outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={addCustomMood}
                disabled={!customMoodLabel.trim()}
                className="shrink-0 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-black uppercase tracking-wider disabled:opacity-40 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={saveCustomMoodForReuse}
                onChange={event => setSaveCustomMoodForReuse(event.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              Save for reuse
            </label>
          </div>
        )}
      </section>

      {/* Intensity Slider */}
      <section className="space-y-8">
        <div className="flex justify-between items-end">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Rating</h2>
          <span className="text-6xl font-black tracking-tighter text-primary">{intensity}</span>
        </div>
        <div className="relative pt-6">
          <input
            type="range"
            min="1"
            max="10"
            step="1"
            value={intensity}
            onChange={(e) => setIntensity(parseInt(e.target.value))}
            aria-label="Mood rating"
            className="w-full h-2 bg-secondary rounded-full appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-4 px-1">
            <span>1 Minimal</span>
            <span>10 Intense</span>
          </div>
        </div>
      </section>

      {/* Energy Slider */}
      <section className="space-y-8">
        <div className="flex justify-between items-end">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Energy Level</h2>
            <p className="text-xs text-muted-foreground mt-1">How energetic or fatigued do you feel?</p>
          </div>
          <span className="text-6xl font-black tracking-tighter text-primary">{energy}</span>
        </div>
        <div className="relative pt-6">
          <input
            type="range"
            min="1"
            max="10"
            step="1"
            value={energy}
            onChange={(e) => setEnergy(parseInt(e.target.value))}
            className="w-full h-2 bg-secondary rounded-full appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-4 px-1">
            <span>Fatigued</span>
            <span>Hyper-energized</span>
          </div>
        </div>
      </section>

      {/* Factor Tracking */}
      <section className="space-y-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">What's influencing this?</h2>
          <span className={cn(
            "text-[10px] font-black uppercase tracking-widest transition-colors",
            selectedFactors.length > 0 ? "text-primary" : "text-muted-foreground/50"
          )}>
            {selectedFactors.length > 0 ? `${selectedFactors.length} selected` : 'Tap to select'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {factors.map((factor) => {
            const Icon = factor.icon;
            const isActive = selectedFactors.includes(factor.id);
            return (
              <button
                key={factor.id}
                type="button"
                onClick={() => toggleFactor(factor.id)}
                aria-pressed={isActive}
                className={cn(
                  "flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-full border-2 text-xs font-bold uppercase tracking-wider transition-all ",
                  isActive
                    ? "bg-primary border-primary text-primary-foreground shadow-md shadow-primary/25"
                    : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {factor.label}
                {isActive && <Check className="w-3 h-3" />}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setShowCustomFactor(prev => !prev)}
            aria-expanded={showCustomFactor}
            className={cn(
              "flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-full border-2 border-dashed text-xs font-bold uppercase tracking-wider transition-all",
              showCustomFactor
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            )}
          >
            <Plus className="w-3.5 h-3.5" /> Other
          </button>
        </div>

        {showCustomFactor && (
          <div className="rounded-sm border-2 border-dashed border-border bg-card p-4 space-y-3">
            <div>
              <label htmlFor="custom-factor" className="text-xs font-bold">Your own influence</label>
              <p className="text-[10px] text-muted-foreground mt-0.5">Type a word or short phrase.</p>
            </div>
            <div className="flex gap-2">
              <input
                id="custom-factor"
                value={customFactorLabel}
                onChange={event => setCustomFactorLabel(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addCustomFactor();
                  }
                }}
                maxLength={32}
                placeholder="e.g. Travel"
                className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-secondary/40 border border-border text-sm focus:outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={addCustomFactor}
                disabled={!customFactorLabel.trim()}
                className="shrink-0 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-black uppercase tracking-wider disabled:opacity-40 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={saveCustomFactorForReuse}
                onChange={event => setSaveCustomFactorForReuse(event.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              Save for reuse
            </label>
          </div>
        )}
      </section>

      {/* Quick Journal Entry */}
      <section className="space-y-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Quick Reflection</h2>
        <div className="relative">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Write down any details... (Will be saved to your journal)"
            className="w-full min-h-[120px] p-6 pb-16 rounded-sm bg-card border-2 border-border text-sm focus:outline-none focus:border-primary transition-all resize-none shadow-sm"
          />
          <VoiceButton
            className="absolute bottom-4 left-4"
            onTranscript={(text) => setNote(prev => appendDictation(prev, text))}
            label="Dictate your reflection"
          />
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={selectedMoods.length === 0 || isSubmitting}
          className={cn(
            "w-full py-4 rounded-2xl flex items-center justify-center gap-2 font-black text-xs uppercase tracking-widest transition-all",
            selectedMoods.length === 0 || isSubmitting
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-primary text-primary-foreground shadow-lg shadow-primary/20 "
          )}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Saving...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" /> Save Check-in
            </>
          )}
        </button>

        <p className="text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
          {selectedMoods.length === 0
            ? 'Pick at least one mood to save your check-in'
            : 'Saves to your mood history and journal'}
        </p>
      </section>

      {/* Monthly Overview */}
      <section className="space-y-8 p-8 rounded-sm bg-secondary/20 border-2 border-dashed border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/20 text-primary">
              <History className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-black tracking-tighter">Patterns</h2>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="p-2 rounded-full hover:bg-card transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-black uppercase tracking-widest">
              {format(currentMonth, 'MMMM yyyy')}
            </span>
            <button 
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="p-2 rounded-full hover:bg-card transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
            <div key={idx} className="text-center text-[10px] font-black text-muted-foreground pb-4">{day}</div>
          ))}
          {days.map((day, idx) => {
            const dayEntries = entries.filter(e => isSameDay(new Date(e.date), day));
            const isCurrentMonth = isSameDay(startOfMonth(day), startOfMonth(currentMonth));
            
            return (
              <div 
                key={idx} 
                className={cn(
                  "aspect-square rounded-2xl border flex flex-col items-center justify-center gap-1.5 relative group cursor-default p-1",
                  isCurrentMonth ? "bg-card/50 border-border/50" : "opacity-20 pointer-events-none"
                )}
              >
                <span className="text-[10px] font-black text-muted-foreground/60">{format(day, 'd')}</span>
                <div className="flex flex-wrap justify-center gap-0.5">
                  {dayEntries.slice(0, 4).map((entry, eIdx) => {
                    const mood = moods.find(m => m.id === entry.moodId);
                    const label = entry.moodLabels?.[entry.moodId] || mood?.label || 'Mood';
                    return (
                      <div 
                        key={eIdx}
                        className={cn("w-2 h-2 rounded-full", mood?.activeColor.split(' ')[0] || 'bg-primary')} 
                        title={`${label} (${entry.intensity}/10)`}
                      />
                    );
                  })}
                  {dayEntries.length > 4 && <div className="w-2 h-2 rounded-full bg-muted border border-border" />}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default Mood;
