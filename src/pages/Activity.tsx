import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Activity as ActivityIcon, Info, Plus, X, Timer, Flame, Footprints } from '../components/icons';
import { cn } from '../lib/utils';
import VoiceButton from '../components/VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';
import { useAuth } from '../components/AuthProvider';
import { storage } from '../lib/storage';
import { ActivityLog, Workout } from '../types';
import { format } from 'date-fns';

const Activity: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [isLogging, setIsLogging] = useState(false);
  const [newLog, setNewLog] = useState({
    steps: 8500,
    activeMinutes: 45,
    calories: 320,
    notes: '',
    activities: [] as { name: string; duration: string }[]
  });
  const [activityInput, setActivityInput] = useState({ name: '', duration: '' });

  useEffect(() => {
    const today = format(new Date(), 'yyyy-MM-dd');

    // Fetch activity logs
    const unsubLogs = storage.subscribe(storage.key.ACTIVITY_LOGS, (data) => {
      const dailyLogs = (data as ActivityLog[]).filter(log => log.date === today);
      setLogs(dailyLogs);
    });

    // Fetch workouts for today (automatic transfer)
    const unsubWorkouts = storage.subscribe(storage.key.WORKOUTS, (data) => {
      const dailyWorkouts = (data as Workout[]).filter(w => format(new Date(w.date), 'yyyy-MM-dd') === today);
      setWorkouts(dailyWorkouts);
    });

    return () => {
      unsubLogs();
      unsubWorkouts();
    };
  }, []);

  const handleSaveLog = async () => {
    try {
      await storage.add(storage.key.ACTIVITY_LOGS, {
        ...newLog,
        uid: user?.uid || 'guest',
        date: format(new Date(), 'yyyy-MM-dd'),
        createdAt: new Date().toISOString()
      });
      setIsLogging(false);
      setNewLog({
        steps: 8500,
        activeMinutes: 45,
        calories: 320,
        notes: '',
        activities: []
      });
    } catch (error) {
      console.error('Error saving activity log:', error);
    }
  };

  const addActivity = () => {
    if (activityInput.name && activityInput.duration) {
      setNewLog(prev => ({
        ...prev,
        activities: [...prev.activities!, activityInput]
      }));
      setActivityInput({ name: '', duration: '' });
    }
  };

  const removeActivity = (index: number) => {
    setNewLog(prev => ({
      ...prev,
      activities: prev.activities!.filter((_, i) => i !== index)
    }));
  };

  const totalSteps = logs.reduce((acc, log) => acc + (log.steps || 0), 0) || 8432;
  const totalMinutes = logs.reduce((acc, log) => acc + (log.activeMinutes || 0), 0) + 
                       workouts.reduce((acc, w) => acc + parseInt(w.duration || '0'), 0);
  const totalCalories = logs.reduce((acc, log) => acc + (log.calories || 0), 0) || 342;

  const allActivities = [
    ...workouts.map(w => ({ name: w.name, duration: `${w.duration}m` })),
    ...logs.flatMap(l => l.activities || [])
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-30 bg-background/80 p-6 flex items-center gap-4">
        <button 
          onClick={() => navigate(-1)}
          className="p-2 text-primary hover:bg-primary/10 rounded-full transition-all"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold text-primary tracking-tight">Activity</h1>
      </header>

      <main className="p-6 space-y-8">
        {/* Main Stat */}
        <div className="text-center space-y-2">
          <div className="p-6 rounded-full bg-primary/10 text-primary w-fit mx-auto">
            <ActivityIcon className="w-12 h-12" />
          </div>
          <h2 className="text-4xl font-black text-foreground">{totalSteps.toLocaleString()}</h2>
          <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Steps Today</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-8 rounded-sm bg-card border border-border shadow-sm space-y-2">
            <div className="p-3 rounded-2xl bg-primary/10 text-primary w-fit">
              <Timer className="w-6 h-6" />
            </div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Active Minutes</p>
            <p className="text-2xl font-black text-foreground">{totalMinutes || 45}m</p>
          </div>
          <div className="p-8 rounded-sm bg-card border border-border shadow-sm space-y-2">
            <div className="p-3 rounded-2xl bg-primary/10 text-primary w-fit">
              <Flame className="w-6 h-6" />
            </div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Calories</p>
            <p className="text-2xl font-black text-foreground">{totalCalories || 342}kcal</p>
          </div>
        </div>

        {/* Activities Section */}
        {allActivities.length > 0 && (
          <section className="space-y-4">
            <h3 className="text-lg font-bold text-foreground px-2">Today's Activities</h3>
            <div className="space-y-3">
              {allActivities.map((activity, index) => (
                <div key={index} className="p-6 rounded-sm bg-card border border-border shadow-sm flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="font-bold text-foreground">{activity.name}</p>
                    <p className="text-xs text-muted-foreground">{activity.duration}</p>
                  </div>
                  <div className="p-2 rounded-full bg-primary/10 text-primary">
                    <ActivityIcon className="w-4 h-4" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Log Button */}
        <button 
          onClick={() => setIsLogging(true)}
          className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Log Activity
        </button>

        {/* Apple Health Placeholder */}
        <div className="p-6 rounded-sm bg-primary/5 border border-primary/10 flex items-start gap-4">
          <Info className="w-5 h-5 text-primary mt-1" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-foreground">Apple Health Integration</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Sync your movement data from Apple Health to automatically track your steps, active energy, and stand hours.
            </p>
          </div>
        </div>
      </main>

      {/* Log Modal */}
      <AnimatePresence>
        {isLogging && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsLogging(false)}
              className="absolute inset-0 bg-black/40 "
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative w-full max-w-lg bg-card rounded-t-[2.5rem] sm:rounded-sm p-8 space-y-6 shadow-2xl"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-foreground">Log Activity</h3>
                <button onClick={() => setIsLogging(false)} className="p-2 hover:bg-muted rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Steps</label>
                    <input 
                      type="number"
                      value={newLog.steps}
                      onChange={(e) => setNewLog(prev => ({ ...prev, steps: parseInt(e.target.value) }))}
                      className="w-full p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary font-bold"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Minutes</label>
                    <input 
                      type="number"
                      value={newLog.activeMinutes}
                      onChange={(e) => setNewLog(prev => ({ ...prev, activeMinutes: parseInt(e.target.value) }))}
                      className="w-full p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Calories Burned</label>
                  <input 
                    type="number"
                    value={newLog.calories}
                    onChange={(e) => setNewLog(prev => ({ ...prev, calories: parseInt(e.target.value) }))}
                    className="w-full p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary font-bold"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Add Activities</label>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      placeholder="Activity (e.g. Walking)"
                      value={activityInput.name}
                      onChange={(e) => setActivityInput(prev => ({ ...prev, name: e.target.value }))}
                      className="flex-1 p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary font-medium text-sm"
                    />
                    <VoiceButton
                      className="p-4 rounded-2xl bg-muted"
                      onTranscript={(text) => setActivityInput(prev => ({ ...prev, name: appendDictation(prev.name, text) }))}
                      label="Dictate an activity"
                    />
                    <input 
                      type="text"
                      placeholder="30m"
                      value={activityInput.duration}
                      onChange={(e) => setActivityInput(prev => ({ ...prev, duration: e.target.value }))}
                      className="w-20 p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary font-bold text-sm"
                    />
                    <button 
                      onClick={addActivity}
                      aria-label="Add activity"
                      className="p-4 rounded-2xl bg-primary text-primary-foreground"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 pt-2">
                    {newLog.activities.map((act, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold">
                        <span>{act.name} ({act.duration})</span>
                        <button onClick={() => removeActivity(i)}>
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Notes</label>
                  <div className="relative">
                    <textarea 
                      value={newLog.notes}
                      onChange={(e) => setNewLog(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="How did you feel today?"
                      className="w-full p-4 pb-14 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary font-medium min-h-[80px]"
                    />
                    <VoiceButton
                      className="absolute bottom-3 right-3"
                      onTranscript={(text) => setNewLog(prev => ({ ...prev, notes: appendDictation(prev.notes, text) }))}
                      label="Dictate activity notes"
                    />
                  </div>
                </div>
              </div>

              <button 
                onClick={handleSaveLog}
                className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all"
              >
                Save Log
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Activity;
