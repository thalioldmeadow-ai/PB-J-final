import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Moon, Info, Plus, Star, X, Clock, Zap } from '../components/icons';
import { cn } from '../lib/utils';
import VoiceButton from '../components/VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';
import { useAuth } from '../components/AuthProvider';
import { storage } from '../lib/storage';
import { SleepLog } from '../types';
import { format } from 'date-fns';

const Sleep: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [logs, setLogs] = useState<SleepLog[]>([]);
  const [isLogging, setIsLogging] = useState(false);
  const [newLog, setNewLog] = useState({
    duration: '8h 00m',
    quality: 80,
    notes: ''
  });

  useEffect(() => {
    const unsub = storage.subscribe(storage.key.SLEEP_LOGS, (data) => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const dailyLogs = (data as SleepLog[]).filter(log => log.date === today);
      setLogs(dailyLogs);
    });
    return () => unsub();
  }, []);

  const handleSaveLog = async () => {
    try {
      await storage.add(storage.key.SLEEP_LOGS, {
        ...newLog,
        uid: user?.uid || 'guest',
        date: format(new Date(), 'yyyy-MM-dd'),
        createdAt: new Date().toISOString()
      });
      setIsLogging(false);
    } catch (error) {
      console.error('Error saving sleep log:', error);
    }
  };

  const averageQuality = logs.length > 0 
    ? Math.round(logs.reduce((acc, log) => acc + log.quality, 0) / logs.length)
    : 0;

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-30 bg-background/80 p-6 flex items-center gap-4">
        <button 
          onClick={() => navigate(-1)}
          className="p-2 text-secondary hover:bg-secondary/10 rounded-full transition-all"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold text-secondary tracking-tight">Sleep Quality</h1>
      </header>

      <main className="p-6 space-y-8">
        {/* Sleep Stat */}
        <div className="text-center space-y-2">
          <div className="p-6 rounded-full bg-secondary/10 text-secondary w-fit mx-auto">
            <Moon className="w-12 h-12" />
          </div>
          <h2 className="text-4xl font-black text-foreground">{logs[0]?.duration || '--h --m'}</h2>
          <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Last Night's Sleep</p>
        </div>

        {/* Quality Card */}
        <div className="p-8 rounded-sm bg-card border border-border shadow-sm space-y-6">
          <div className="flex justify-between items-end">
            <div className="space-y-1">
              <h3 className="font-bold text-foreground">Sleep Score</h3>
              <p className="text-xs text-muted-foreground">Based on your rest patterns</p>
            </div>
            <span className="text-3xl font-black text-secondary">{averageQuality || 0}</span>
          </div>
          
          <div className="h-4 bg-muted rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${averageQuality}%` }}
              className="h-full bg-secondary"
            />
          </div>

          <div className="grid grid-cols-3 gap-4 pt-4">
            <div className="text-center space-y-1">
              <Clock className="w-4 h-4 text-secondary/40 mx-auto" />
              <p className="text-[10px] font-bold text-muted-foreground uppercase">Deep</p>
              <p className="text-sm font-bold text-foreground">2h 15m</p>
            </div>
            <div className="text-center space-y-1">
              <Zap className="w-4 h-4 text-secondary/40 mx-auto" />
              <p className="text-[10px] font-bold text-muted-foreground uppercase">REM</p>
              <p className="text-sm font-bold text-foreground">1h 45m</p>
            </div>
            <div className="text-center space-y-1">
              <Star className="w-4 h-4 text-secondary/40 mx-auto" />
              <p className="text-[10px] font-bold text-muted-foreground uppercase">Light</p>
              <p className="text-sm font-bold text-foreground">3h 30m</p>
            </div>
          </div>
        </div>

        {/* Log Button */}
        <button 
          onClick={() => setIsLogging(true)}
          className="w-full py-4 rounded-2xl bg-secondary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-secondary/20 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Log Sleep
        </button>

        {/* Apple Health Placeholder */}
        <div className="p-6 rounded-sm bg-secondary/5 border border-secondary/10 flex items-start gap-4">
          <Info className="w-5 h-5 text-secondary mt-1" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-foreground">Apple Health Integration</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Sync your sleep data from Apple Health to automatically track your REM, deep, and light sleep cycles.
            </p>
          </div>
        </div>

        {/* Tips */}
        <section className="space-y-4">
          <h3 className="text-lg font-bold text-foreground px-2">Sleep Hygiene Tips</h3>
          <div className="space-y-3">
            {[
              'Maintain a consistent sleep schedule',
              'Create a relaxing bedtime routine',
              'Limit blue light exposure before bed',
              'Keep your bedroom cool and dark'
            ].map((tip, i) => (
              <div key={i} className="p-4 rounded-2xl bg-card border border-border shadow-sm text-sm font-medium text-foreground/80">
                {tip}
              </div>
            ))}
          </div>
        </section>
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
                <h3 className="text-xl font-bold text-foreground">Log Sleep</h3>
                <button onClick={() => setIsLogging(false)} className="p-2 hover:bg-muted rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Duration</label>
                  <input 
                    type="text"
                    value={newLog.duration}
                    onChange={(e) => setNewLog(prev => ({ ...prev, duration: e.target.value }))}
                    placeholder="e.g. 8h 30m"
                    className="w-full p-4 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-secondary font-bold"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Quality ({newLog.quality}%)</label>
                  <input 
                    type="range"
                    min="0"
                    max="100"
                    value={newLog.quality}
                    onChange={(e) => setNewLog(prev => ({ ...prev, quality: parseInt(e.target.value) }))}
                    className="w-full accent-secondary"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Notes</label>
                  <div className="relative">
                    <textarea 
                      value={newLog.notes}
                      onChange={(e) => setNewLog(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="How did you feel when you woke up?"
                      className="w-full p-4 pb-14 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-secondary font-medium min-h-[100px]"
                    />
                    <VoiceButton
                      className="absolute bottom-3 right-3"
                      onTranscript={(text) => setNewLog(prev => ({ ...prev, notes: appendDictation(prev.notes, text) }))}
                      label="Dictate sleep notes"
                    />
                  </div>
                </div>
              </div>

              <button 
                onClick={handleSaveLog}
                className="w-full py-4 rounded-2xl bg-secondary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-secondary/20 transition-all"
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

export default Sleep;
