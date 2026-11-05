import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronLeft, Clock, Flame, Info, Dumbbell, Activity, Play, Plus, Target } from '../components/icons';
import { storage } from '../lib/storage';
import { Workout } from '../types';
import { useAuth } from '../components/AuthProvider';
import { cn } from '../lib/utils';

const WorkoutDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWorkout = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const item = await storage.getById<Workout>(storage.key.WORKOUTS, id);
        if (item) {
          setWorkout(item);
        }
      } catch (error) {
        console.error('Error fetching workout:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchWorkout();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!workout) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Workout not found</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-primary font-bold">Go Back</button>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-muted transition-colors">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold tracking-tight text-primary">Workout Details</h1>
        <div className="w-10" />
      </header>

      {/* Hero Section */}
      <section className="relative rounded-sm overflow-hidden aspect-video shadow-lg">
        <img 
          src={workout.photo || `https://picsum.photos/seed/${workout.name}/800/450`} 
          alt={workout.name}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-black/55 flex flex-col justify-end p-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary-foreground/80">{workout.type}</span>
            <span className="text-primary-foreground/40">•</span>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary-foreground/80">{workout.duration}</span>
          </div>
          <h2 className="text-3xl font-black text-primary-foreground tracking-tighter">{workout.name}</h2>
        </div>
      </section>

      {/* Stats Bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-sky/10 border border-sky/20 flex flex-col items-center gap-1">
          <Clock className="w-4 h-4 text-sky" />
          <span className="text-lg font-bold">{workout.duration || '30m'}</span>
          <span className="text-[8px] font-bold uppercase tracking-widest text-sky-foreground/60">Duration</span>
        </div>
        <div className="p-4 rounded-2xl bg-rose/10 border border-rose/20 flex flex-col items-center gap-1">
          <Flame className="w-4 h-4 text-rose" />
          <span className="text-lg font-bold">{workout.calories || 0}</span>
          <span className="text-[8px] font-bold uppercase tracking-widest text-rose-foreground/60">Burn</span>
        </div>
        <div className="p-4 rounded-2xl bg-moss/10 border border-moss/20 flex flex-col items-center gap-1">
          <Target className="w-4 h-4 text-moss" />
          <span className="text-lg font-bold">{workout.type?.split(' ')[0] || 'Active'}</span>
          <span className="text-[8px] font-bold uppercase tracking-widest text-moss-foreground/60">Focus</span>
        </div>
      </div>

      {/* Routine Info */}
      <div className="grid gap-8">
        {workout.exercises && workout.exercises.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-bold">Exercises</h3>
            </div>
            <div className="space-y-3">
              {workout.exercises.map((ex, i) => (
                <div key={i} className="bg-card rounded-2xl p-5 border border-border shadow-sm flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-foreground">{ex.name}</h4>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      {ex.sets ? `${ex.sets} sets` : ''} {ex.reps ? `• ${ex.reps} reps` : ''} {ex.weight ? `• ${ex.weight}` : ''}
                    </p>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center text-secondary">
                    <Dumbbell className="w-4 h-4" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Info className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">Instructions</h3>
          </div>
          <div className="bg-card rounded-sm p-6 border border-border shadow-sm">
            <p className="text-sm font-medium leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {workout.instructions || workout.details || 'No specific instructions provided. Remember to breathe and maintain good form!'}
            </p>
          </div>
        </section>

        {workout.link && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Play className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-bold">Watch Video</h3>
            </div>
            <a 
              href={workout.link} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center justify-between p-6 rounded-2xl bg-muted/50 border border-border hover:bg-muted transition-all group"
            >
              <span className="text-sm font-medium truncate flex-1 mr-4">{workout.link}</span>
              <Play className="w-4 h-4 text-primary group- transition-transform fill-current" />
            </a>
          </section>
        )}
      </div>

      <div className="flex gap-4">
        <button
          onClick={() => navigate('/assign-workout')}
          className="flex-1 py-4 rounded-2xl bg-secondary text-secondary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-secondary/20 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Re-schedule
        </button>
        <button
          className="flex-[2] py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2"
        >
          <Play className="w-4 h-4 fill-current" />
          Begin Session
        </button>
      </div>
    </div>
  );
};

export default WorkoutDetail;
