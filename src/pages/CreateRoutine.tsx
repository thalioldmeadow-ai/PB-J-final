import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Plus, Trash2, Clock, Save, Coffee, Sun, Moon, Zap, Activity, Heart, Brain, Lightbulb, ArrowUp, ArrowDown } from '../components/icons';
import { cn } from '../lib/utils';
import VoiceButton from '../components/VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';
import { useAuth } from '../components/AuthProvider';
import { storage } from '../lib/storage';
import { motion } from 'motion/react';

const ICONS = [
  { id: 'coffee', icon: Coffee },
  { id: 'sun', icon: Sun },
  { id: 'moon', icon: Moon },
  { id: 'zap', icon: Zap },
  { id: 'activity', icon: Activity },
  { id: 'heart', icon: Heart },
  { id: 'brain', icon: Brain },
  { id: 'sparkles', icon: Lightbulb },
];

interface StepEntry {
  id: string;
  title: string;
  duration: string;
  icon: string;
}

const CreateRoutine: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [steps, setSteps] = useState<StepEntry[]>([
    { id: '1', title: '', duration: '5', icon: 'sun' }
  ]);
  const [isSaving, setIsSaving] = useState(false);

  // Debug logging
  useEffect(() => {
  }, [user]);

  const addStep = () => {
    const newId = Math.random().toString(36).substring(2, 11);
    setSteps(prev => [...prev, { id: newId, title: '', duration: '5', icon: 'sun' }]);
  };

  const removeStep = (id: string) => {
    if (steps.length > 1) {
      setSteps(prev => prev.filter(s => s.id !== id));
    }
  };

  const updateStep = (id: string, field: keyof StepEntry, value: string) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const moveStepUp = (index: number) => {
    if (index === 0) return;
    const newSteps = [...steps];
    const temp = newSteps[index];
    newSteps[index] = newSteps[index - 1];
    newSteps[index - 1] = temp;
    setSteps(newSteps);
  };

  const moveStepDown = (index: number) => {
    if (index === steps.length - 1) return;
    const newSteps = [...steps];
    const temp = newSteps[index];
    newSteps[index] = newSteps[index + 1];
    newSteps[index + 1] = temp;
    setSteps(newSteps);
  };

  const totalMinutes = steps.reduce((acc, s) => acc + (parseInt(s.duration) || 0), 0);

  const handleSave = async () => {
    if (!title.trim() || !user) return;
    setIsSaving(true);

    try {
      const routineData = {
        uid: user.uid,
        name: title.trim(),
        type: 'custom',
        order: Date.now(),
        steps: steps.map((s, idx) => ({
          id: `s${idx}-${Math.random().toString(36).substring(2, 6)}`,
          title: s.title || 'Untitled Step',
          subtitle: `${s.duration} min`,
          duration: (parseInt(s.duration) || 0) * 60,
          icon: s.icon,
          completed: false
        })),
        createdAt: new Date().toISOString()
      };

      await storage.add(storage.key.ROUTINES, routineData);
      navigate('/routines');
    } catch (error) {
      console.error('Error saving routine:', error);
      alert('Failed to save routine. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="text-sm font-medium text-muted-foreground">Preparing your routine creator...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-24">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate(-1)}
            className="p-2 text-primary hover:bg-primary/10 rounded-full transition-all"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold text-primary tracking-tight">Create Routine</h1>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary">
          <Clock className="w-4 h-4" />
          <span className="text-xs font-bold">{totalMinutes} min</span>
        </div>
      </div>

      <div className="space-y-8">
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-4">Routine Title</label>
          <div className="relative">
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Morning Focus"
              className="w-full p-6 pr-16 rounded-sm bg-card border border-border shadow-sm focus:ring-2 focus:ring-primary text-lg font-bold tracking-tight placeholder:text-muted-foreground/20"
            />
            <VoiceButton
              className="absolute right-4 top-1/2 -translate-y-1/2"
              onTranscript={(text) => setTitle(prev => appendDictation(prev, text))}
              label="Dictate routine title"
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-end px-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Routine Steps</label>
            <span className="text-[10px] font-bold text-muted-foreground/40">{steps.length} items</span>
          </div>

          <div className="space-y-3">
            {steps.map((step, idx) => (
              <div
                key={step.id}
                className="p-5 rounded-sm bg-card border border-border shadow-sm flex items-center gap-4 group animate-in fade-in duration-200"
              >
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveStepUp(idx)}
                    className="p-1 px-1.5 rounded-lg bg-background hover:bg-muted text-muted-foreground disabled:opacity-20 transition-all border border-border/40"
                    title="Move Step Up"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === steps.length - 1}
                    onClick={() => moveStepDown(idx)}
                    className="p-1 px-1.5 rounded-lg bg-background hover:bg-muted text-muted-foreground disabled:opacity-20 transition-all border border-border/40"
                    title="Move Step Down"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                
                <div className="flex-1 space-y-4 min-w-0">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="text"
                      value={step.title}
                      onChange={(e) => updateStep(step.id, 'title', e.target.value)}
                      placeholder="Step name..."
                      className="flex-1 bg-background border border-border/50 rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/30 transition-all"
                    />
                    <VoiceButton
                      size="sm"
                      className="self-center bg-background border border-border/50 p-3"
                      onTranscript={(text) => updateStep(step.id, 'title', appendDictation(step.title, text))}
                      label="Dictate step name"
                    />
                    <div className="relative w-full sm:w-28 flex-shrink-0">
                      <input
                        type="number"
                        value={step.duration}
                        onChange={(e) => updateStep(step.id, 'duration', e.target.value)}
                        className="w-full bg-background border border-border/50 rounded-2xl p-4 text-sm font-bold focus:ring-2 focus:ring-primary pr-12 transition-all"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] font-black text-muted-foreground/40 uppercase">min</span>
                    </div>
                  </div>

                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide px-1 -mx-1">
                    {ICONS.map(({ id: iconId, icon: Icon }) => (
                      <button
                        key={iconId}
                        type="button"
                        onClick={() => updateStep(step.id, 'icon', iconId)}
                        className={cn(
                           "p-3 rounded-xl transition-all flex-shrink-0 border-2",
                           step.icon === iconId 
                             ? "bg-primary text-primary-foreground border-primary shadow-md scale-105" 
                             : "bg-background text-muted-foreground/40 border-border/50 hover:border-primary/30 hover:text-primary"
                        )}
                      >
                        <Icon className="w-4 h-4" />
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={() => removeStep(step.id)}
                  className="p-2 text-muted-foreground/30 hover:text-red-500 transition-all opacity-100 flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={addStep}
            className="w-full py-4 rounded-2xl border-2 border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-all flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-widest"
          >
            <Plus className="w-4 h-4" />
            Add Step
          </button>
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving || !title.trim()}
          className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" />
          {isSaving ? "Saving..." : "Save Routine"}
        </button>
      </div>
    </div>
  );
};

export default CreateRoutine;
