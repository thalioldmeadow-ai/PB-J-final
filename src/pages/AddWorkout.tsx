import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Plus, Search, Edit3, ArrowRight, Camera, X, Activity } from '../components/icons';
import { cn, compressImage } from '../lib/utils';
import VoiceButton from '../components/VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';
import { useAuth } from '../components/AuthProvider';
import { storage } from '../lib/storage';
import { Exercise } from '../types';

const AddWorkout: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  
  const [mode, setMode] = useState<'selection' | 'manual'>('selection');
  const [workoutType, setWorkoutType] = useState<string>(searchParams.get('type') || 'strength');
  const [date, setDate] = useState<string>(searchParams.get('date') || new Date().toISOString());
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Manual Entry State
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('');
  const [calories, setCalories] = useState('');
  const [exercises, setExercises] = useState<Exercise[]>([{ name: '', sets: '', reps: '', weight: '' }]);
  const [instructions, setInstructions] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Recent Workouts State
  const [recentWorkouts, setRecentWorkouts] = useState<any[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  React.useEffect(() => {
    fetchRecentWorkouts();
  }, []);

  const fetchRecentWorkouts = async () => {
    setLoadingRecent(true);
    try {
      const allWorkouts = await storage.getAll<any>(storage.key.WORKOUTS);
      setRecentWorkouts(allWorkouts.sort((a, b) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime()).slice(0, 5));
    } catch (error) {
      console.error('Error fetching recent workouts:', error);
    } finally {
      setLoadingRecent(false);
    }
  };

  const handleAddExercise = () => setExercises([...exercises, { name: '', sets: '', reps: '', weight: '' }]);
  const handleExerciseChange = (index: number, field: keyof Exercise, value: string) => {
    const newExercises = [...exercises];
    newExercises[index] = { ...newExercises[index], [field]: value };
    setExercises(newExercises);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const compressed = await compressImage(reader.result as string);
          setPhoto(compressed);
        } catch (error) {
          console.error('Error compressing image:', error);
          setPhoto(reader.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    
    const workoutData = {
      uid: user?.uid || 'guest',
      name,
      type: workoutType,
      duration: duration || '30 min',
      calories: parseInt(calories) || 0,
      exercises: exercises.filter(e => e.name.trim() !== ''),
      instructions,
      photo: photo || undefined,
      date,
      createdAt: new Date().toISOString()
    };

    try {
      // Store in session storage to pass to the assignment page
      sessionStorage.setItem('pendingWorkout', JSON.stringify(workoutData));
      navigate('/assign-workout');
    } catch (error) {
      console.error("Error saving workout to session storage:", error);
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        alert('Workout data is too large (likely the photo). Please try without the photo or use a smaller one.');
      } else {
        alert('An error occurred. Please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickAdd = (workout: any) => {
    const workoutData = {
      ...workout,
      uid: user?.uid || 'guest',
      date,
      createdAt: new Date().toISOString()
    };

    sessionStorage.setItem('pendingWorkout', JSON.stringify(workoutData));
    navigate('/assign-workout');
  };

  const renderSelection = () => (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground/40" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search for workouts..."
          className="w-full pl-12 pr-4 py-4 rounded-full bg-muted/50 border-none focus:ring-2 focus:ring-primary/20 text-sm"
        />
      </div>

      {/* Manual Entry Card */}
      <button
        onClick={() => setMode('manual')}
        className="w-full p-6 rounded-sm bg-moss/20 border border-moss/30 shadow-sm hover:shadow-md transition-all flex items-center gap-6 text-left group"
      >
        <div className="p-4 rounded-full bg-moss text-primary-foreground shadow-sm">
          <Edit3 className="w-6 h-6" />
        </div>
        <div className="flex-1 space-y-1">
          <h3 className="font-bold text-foreground">Manual Entry</h3>
          <p className="text-[11px] text-muted-foreground leading-tight">Log your own workout details manually.</p>
        </div>
        <ArrowRight className="w-5 h-5 text-muted-foreground transition-transform" />
      </button>

      {/* Recent Workouts Section */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold text-foreground px-2">Recent Workouts</h2>
        <div className="space-y-3">
          {recentWorkouts.length > 0 ? (
            recentWorkouts.map((workout, idx) => (
              <div key={workout.id} className={cn(
                "p-5 rounded-sm border shadow-sm flex items-center gap-4 group transition-all hover:shadow-md",
                idx % 4 === 0 ? "bg-sky/20 border-sky/30" : idx % 4 === 1 ? "bg-rose/20 border-rose/30" : idx % 4 === 2 ? "bg-moss/20 border-moss/30" : "bg-lavender/20 border-lavender/30"
              )}>
                <div className="p-3 rounded-full bg-card/80 text-primary shadow-sm">
                  <Activity className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-foreground truncate">{workout.name}</h4>
                    <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40">RECENT</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {workout.duration} • {workout.type}
                  </p>
                </div>
                <button 
                  onClick={() => handleQuickAdd(workout)}
                  className="p-3 rounded-full bg-card/80 text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-all shadow-sm"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            ))
          ) : (
            <div className="text-center py-12 rounded-sm bg-muted/30 border-2 border-dashed border-border text-muted-foreground text-xs italic">
              No recent workouts yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );

  const renderManual = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500 pb-24">
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Workout Name</label>
          <div className="relative">
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Full Body Strength"
              className="w-full p-4 pr-14 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm"
            />
            <VoiceButton
              className="absolute right-3 top-1/2 -translate-y-1/2"
              onTranscript={(text) => setName(prev => appendDictation(prev, text))}
              label="Dictate workout name"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Duration</label>
            <input
              type="text"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="e.g. 45 min"
              className="w-full p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Calories</label>
            <input
              type="number"
              value={calories}
              onChange={(e) => setCalories(e.target.value)}
              placeholder="0"
              className="w-full p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm"
            />
          </div>
        </div>

        <div className="space-y-4">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Exercises</label>
          <div className="space-y-4">
            {exercises.map((exercise, index) => (
              <div key={index} className="p-4 rounded-2xl bg-muted/30 border border-border space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    value={exercise.name}
                    onChange={(e) => handleExerciseChange(index, 'name', e.target.value)}
                    placeholder={`Exercise ${index + 1} Name`}
                    className="w-full p-3 pr-11 rounded-xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm"
                  />
                  <VoiceButton
                    size="sm"
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    onTranscript={(text) => handleExerciseChange(index, 'name', appendDictation(exercise.name, text))}
                    label="Dictate exercise name"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-[8px] font-bold uppercase text-muted-foreground ml-1">Sets</label>
                    <input
                      type="text"
                      value={exercise.sets}
                      onChange={(e) => handleExerciseChange(index, 'sets', e.target.value)}
                      placeholder="3"
                      className="w-full p-2 rounded-xl bg-muted border-none focus:ring-2 focus:ring-primary text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-bold uppercase text-muted-foreground ml-1">Reps</label>
                    <input
                      type="text"
                      value={exercise.reps}
                      onChange={(e) => handleExerciseChange(index, 'reps', e.target.value)}
                      placeholder="12"
                      className="w-full p-2 rounded-xl bg-muted border-none focus:ring-2 focus:ring-primary text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-bold uppercase text-muted-foreground ml-1">Weight</label>
                    <input
                      type="text"
                      value={exercise.weight}
                      onChange={(e) => handleExerciseChange(index, 'weight', e.target.value)}
                      placeholder="10kg"
                      className="w-full p-2 rounded-xl bg-muted border-none focus:ring-2 focus:ring-primary text-xs"
                    />
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={handleAddExercise}
              className="flex items-center gap-2 text-[10px] font-bold text-primary p-2 hover:bg-primary/10 rounded-lg transition-all uppercase tracking-widest"
            >
              <Plus className="w-3 h-3" />
              Add Exercise
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Instructions</label>
          <div className="relative">
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Notes or instructions..."
              rows={4}
              className="w-full p-4 pb-14 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm resize-none"
            />
            <VoiceButton
              className="absolute bottom-3 right-3"
              onTranscript={(text) => setInstructions(prev => appendDictation(prev, text))}
              label="Dictate instructions"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Workout Photo</label>
          <div className="flex items-center gap-4">
            <label className="flex-1 flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer">
              <Camera className="w-6 h-6 text-muted-foreground mb-2" />
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Upload Photo</span>
              <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
            </label>
            {photo && (
              <div className="relative w-24 h-24 rounded-2xl overflow-hidden border border-border">
                <img src={photo} alt="Preview" className="w-full h-full object-cover" />
                <button 
                  onClick={() => setPhoto(null)}
                  className="absolute top-1 right-1 p-1 rounded-full bg-black/50 text-primary-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={isSaving || !name.trim()}
        className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all disabled:opacity-50"
      >
        {isSaving ? "Saving..." : "Save Workout"}
      </button>
    </div>
  );

  return (
    <div className="space-y-8 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <button 
          onClick={() => mode === 'selection' ? navigate(-1) : setMode('selection')}
          className="p-2 text-primary hover:bg-primary/10 rounded-full transition-all"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold text-primary tracking-tight">
          {mode === 'selection' ? 'Log Workout' : 'Manual Entry'}
        </h1>
      </div>

      <div className="space-y-8">
        {mode === 'selection' && renderSelection()}
        {mode === 'manual' && renderManual()}
      </div>
    </div>
  );
};

export default AddWorkout;
