import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Heart, 
  ChevronRight, 
  Activity, 
  Moon, 
  Utensils, 
  Droplets, 
  Lightbulb, 
  ChevronLeft, 
  Calendar, 
  Beef, 
  Croissant, 
  Egg, 
  Clock, 
  ShieldAlert, 
  Percent 
} from '../components/icons';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useTheme } from '../components/ThemeProvider';
import { storage } from '../lib/storage';
import { Meal, Workout, SleepLog, ActivityLog, MoodEntry, CycleEntry } from '../types';
import { format } from 'date-fns';
import AiAssist from '../components/AiAssist';
import { loadProgressFacts } from '../lib/aiFacts';

const Health: React.FC = () => {
  const { settings } = useTheme();

  // Storage data states
  const [meals, setMeals] = useState<Meal[]>([]);
  const [hydration, setHydration] = useState<any[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [sleepLogs, setSleepLogs] = useState<SleepLog[]>([]);
  const [moodEntries, setMoodEntries] = useState<MoodEntry[]>([]);
  const [cycleEntries, setCycleEntries] = useState<CycleEntry[]>([]);

  // Selected month for overview
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  useEffect(() => {
    const unsubMeals = storage.subscribe(storage.key.MEALS, (data) => setMeals(data as Meal[]));
    const unsubHydration = storage.subscribe('serene_hydration', (data) => setHydration(data || []));
    const unsubWorkouts = storage.subscribe(storage.key.WORKOUTS, (data) => setWorkouts(data as Workout[]));
    const unsubActivity = storage.subscribe(storage.key.ACTIVITY_LOGS, (data) => setActivityLogs(data as ActivityLog[]));
    const unsubSleep = storage.subscribe(storage.key.SLEEP_LOGS, (data) => setSleepLogs(data as SleepLog[]));
    const unsubMood = storage.subscribe(storage.key.MOOD_ENTRIES, (data) => setMoodEntries(data as MoodEntry[]));
    const unsubCycle = storage.subscribe(storage.key.CYCLE_ENTRIES, (data) => setCycleEntries(data as CycleEntry[]));

    return () => {
      unsubMeals();
      unsubHydration();
      unsubWorkouts();
      unsubActivity();
      unsubSleep();
      unsubMood();
      unsubCycle();
    };
  }, []);

  const prevMonth = () => {
    setSelectedDate(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() - 1);
      return d;
    });
  };

  const nextMonth = () => {
    setSelectedDate(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + 1);
      return d;
    });
  };

  // Helper inside month checks
  const isInSelectedMonth = (dateStr: string) => {
    if (!dateStr) return false;
    try {
      const d = new Date(dateStr);
      return d.getFullYear() === selectedDate.getFullYear() && d.getMonth() === selectedDate.getMonth();
    } catch {
      return false;
    }
  };

  // 1. Nutrition Aggregations
  const monthlyMeals = meals.filter(m => isInSelectedMonth(m.date));
  const uniqueDaysWithMeals = Array.from(new Set(monthlyMeals.map(m => {
    try {
      return format(new Date(m.date), 'yyyy-MM-dd');
    } catch {
      return '';
    }
  }).filter(Boolean)));
  
  const totalCalories = monthlyMeals.reduce((acc, m) => acc + (m.calories || 0), 0);
  const avgDailyCalories = uniqueDaysWithMeals.length > 0 ? Math.round(totalCalories / uniqueDaysWithMeals.length) : 0;

  const totalProtein = monthlyMeals.reduce((acc, m) => acc + (m.protein || 0), 0);
  const avgDailyProtein = uniqueDaysWithMeals.length > 0 ? Math.round(totalProtein / uniqueDaysWithMeals.length) : 0;

  const totalCarbs = monthlyMeals.reduce((acc, m) => acc + (m.carbs || 0), 0);
  const avgDailyCarbs = uniqueDaysWithMeals.length > 0 ? Math.round(totalCarbs / uniqueDaysWithMeals.length) : 0;

  const totalFats = monthlyMeals.reduce((acc, m) => acc + (m.fats || 0), 0);
  const avgDailyFats = uniqueDaysWithMeals.length > 0 ? Math.round(totalFats / uniqueDaysWithMeals.length) : 0;

  const monthlyHydration = hydration.filter(h => isInSelectedMonth(h.date));
  const totalWater = monthlyHydration.reduce((acc, h) => acc + (h.amount || 0), 0);
  const avgDailyHydration = monthlyHydration.length > 0 ? (totalWater / monthlyHydration.length).toFixed(1) : '0';

  // 2. Activity & Workouts Aggregations
  const monthlyWorkouts = workouts.filter(w => isInSelectedMonth(w.date));
  const totalWorkoutsLogged = monthlyWorkouts.length;
  const totalWorkoutCalBurned = monthlyWorkouts.reduce((acc, w) => acc + (w.calories || 0), 0);

  const monthlyActivity = activityLogs.filter(a => isInSelectedMonth(a.date));
  const totalSteps = monthlyActivity.reduce((acc, a) => acc + (a.steps || 0), 0);
  const avgDailySteps = monthlyActivity.length > 0 ? Math.round(totalSteps / monthlyActivity.length) : 0;
  const totalActiveMinutes = monthlyActivity.reduce((acc, a) => acc + (a.activeMinutes || 0), 0);
  const avgDailyActiveMinutes = monthlyActivity.length > 0 ? Math.round(totalActiveMinutes / monthlyActivity.length) : 0;

  // 3. Sleep Aggregations
  const parseSleepDuration = (dur: string): number => {
    if (!dur) return 0;
    const hMatch = dur.match(/(\d+)h/);
    const mMatch = dur.match(/(\d+)m/);
    const h = hMatch ? parseInt(hMatch[1], 10) : 0;
    const m = mMatch ? parseInt(mMatch[1], 10) : 0;
    return h + (m / 60);
  };

  const monthlySleep = sleepLogs.filter(s => isInSelectedMonth(s.date));
  const totalSleepLogs = monthlySleep.length;
  const avgSleepQuality = monthlySleep.length > 0 
    ? Math.round(monthlySleep.reduce((acc, s) => acc + (s.quality || 0), 0) / totalSleepLogs) 
    : 0;
  const avgSleepDurationHours = monthlySleep.length > 0
    ? (monthlySleep.reduce((acc, s) => acc + parseSleepDuration(s.duration), 0) / totalSleepLogs).toFixed(1)
    : '0';

  // 4. Mood & Energy Aggregations
  const monthlyMoods = moodEntries.filter(me => isInSelectedMonth(me.date));
  const totalMoodLogs = monthlyMoods.length;
  const avgMoodIntensity = totalMoodLogs > 0
    ? (monthlyMoods.reduce((acc, m) => acc + (m.intensity || 0), 0) / totalMoodLogs).toFixed(1)
    : '0';
  const avgEnergyLevel = totalMoodLogs > 0
    ? (monthlyMoods.reduce((acc, m) => acc + (m.energy || 0), 0) / totalMoodLogs).toFixed(1)
    : '0';

  // 5. Hormonal Health Flow Days
  const monthlyCycle = cycleEntries.filter(ce => isInSelectedMonth(ce.date));
  const totalFlowDays = monthlyCycle.filter(ce => ce.flow && ce.flow !== 'none').length;

  // Total tracks count to verify if any data is logged this month
  const totalIndexedLogs = monthlyMeals.length + monthlyHydration.length + monthlyWorkouts.length + monthlyActivity.length + monthlySleep.length + monthlyMoods.length + monthlyCycle.length;

  const healthCategories = [
    {
      title: 'Cycle Tracking',
      description: 'Monitor your hormonal health and patterns.',
      icon: Droplets,
      path: '/health/cycle',
      color: 'text-[#D46A7E]',
      bg: 'bg-[#FFD1DC]',
      show: settings.showCycleTracking
    },
    {
      title: 'Sleep Quality',
      description: 'Track your rest and recovery cycles.',
      icon: Moon,
      path: '/health/sleep',
      color: 'text-[#3F51B5]',
      bg: 'bg-[#E8EAF6]',
      show: true
    },
    {
      title: 'Nutrition',
      description: 'Mindful eating and hydration tracking.',
      icon: Utensils,
      path: '/health/nutrition',
      color: 'text-[#00796B]',
      bg: 'bg-[#E0F2F1]',
      show: true
    },
    {
      title: 'Activity',
      description: 'Movement and energy level monitoring.',
      icon: Activity,
      path: '/health/activity',
      color: 'text-[#8A6A2F]',
      bg: 'bg-[#E3D6B8]',
      show: true
    },
    {
      title: 'Mood & Energy',
      description: 'Track your emotional state and energy levels.',
      icon: Lightbulb,
      path: '/health/mood',
      color: 'text-[#9575CD]',
      bg: 'bg-[#F3E5F5]',
      show: true
    }
  ].filter(c => c.show);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <Heart className="w-6 h-6" />
          <h1 className="text-3xl font-black tracking-tighter">Health & Well-being</h1>
        </div>
        <p className="text-muted-foreground font-medium">Nurture your body and mind with mindful tracking.</p>
      </header>

      <AiAssist
        title="Progress and trends"
        description="Compares the last 7 days with the 7 before it, from your logged records. Missing collections are named rather than filled in."
        mode="progress"
        suggestions={[
          { label: 'Summarise my week', prompt: 'Summarise my progress over the last week using the recorded figures.' },
          { label: 'Any trends?', prompt: 'What trends do you see compared with the week before?' },
          { label: 'What next?', prompt: 'What is one realistic improvement for next week?' },
        ]}
        context={async () => ({ week: await loadProgressFacts(7), month: await loadProgressFacts(28) })}
      />

      {/* Categories Grid */}
      <div className="grid gap-4">
        {healthCategories.map((category, index) => (
          <Link key={index} to={category.path}>
            <motion.div
              whileHover={{ x: 4 }}
              className={cn(
                "flex items-center gap-4 p-6 rounded-sm bg-card border-2 transition-all group shadow-sm hover:shadow-md",
                category.bg.replace('bg-', 'border-')
              )}
            >
              <div className={cn("p-4 rounded-2xl", category.bg, category.color)}>
                <category.icon className="w-6 h-6" />
              </div>
              <div className="flex-1 space-y-1">
                <h3 className="font-bold tracking-tight">{category.title}</h3>
                <p className="text-xs text-muted-foreground font-medium">{category.description}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </motion.div>
          </Link>
        ))}
      </div>

      {/* Bottom Monthly Health Statistics Dashboard */}
      <section className="space-y-4 pt-4 border-t border-border/40">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h3 className="font-black text-lg text-foreground uppercase tracking-tight">Monthly Trends</h3>
            <p className="text-xs text-muted-foreground font-medium">Aggregated logs across your entire health suite</p>
          </div>

          <div className="flex items-center gap-1.5 bg-card border border-border/80 px-2 py-1.5 rounded-2xl shadow-sm">
            <button
              onClick={prevMonth}
              aria-label="Previous month"
              className="p-1 px-1.5 bg-background border border-border/40 hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-black uppercase text-foreground px-2 min-w-[90px] text-center">
              {format(selectedDate, 'MMM yyyy')}
            </span>
            <button
              onClick={nextMonth}
              aria-label="Next month"
              className="p-1 px-1.5 bg-background border border-border/40 hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {totalIndexedLogs === 0 ? (
          <div className="p-10 rounded-sm bg-card border border-dashed border-border text-center space-y-4">
            <div className="p-3 bg-muted rounded-full w-fit mx-auto text-muted-foreground">
              <Calendar className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h4 className="font-bold text-sm text-foreground">No records found for {format(selectedDate, 'MMMM yyyy')}</h4>
              <p className="text-xs text-muted-foreground max-w-[320px] mx-auto leading-relaxed">
                Log meals, workouts, sleep, mood, or cycle information to see your monthly charts and analytics populated here.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* 1. Nutrition summary */}
            <div className="p-6 rounded-sm bg-card border border-border shadow-sm flex flex-col justify-between space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-border/40">
                <div className="p-1.5 rounded-xl bg-[#E0F2F1] text-[#00796B]">
                  <Utensils className="w-4 h-4" />
                </div>
                <h4 className="text-xs font-black uppercase tracking-wider text-foreground">Monthly Nutrition</h4>
              </div>

              <div className="space-y-3 flex-1 flex flex-col justify-center">
                <div className="flex items-end justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Avg Daily Intake</span>
                  <span className="text-lg font-black text-teal-600 ">{avgDailyCalories} kcal</span>
                </div>

                <div className="grid grid-cols-4 gap-2 pt-1">
                  <div className="text-center p-2 rounded-xl bg-secondary/10 space-y-1">
                    <Beef className="w-4 h-4 text-accent/60 mx-auto" />
                    <p className="text-[8px] font-bold text-muted-foreground uppercase">Pro</p>
                    <p className="text-[11px] font-black">{avgDailyProtein}g</p>
                  </div>
                  <div className="text-center p-2 rounded-xl bg-secondary/10 space-y-1">
                    <Croissant className="w-4 h-4 text-accent/60 mx-auto" />
                    <p className="text-[8px] font-bold text-muted-foreground uppercase">Carb</p>
                    <p className="text-[11px] font-black">{avgDailyCarbs}g</p>
                  </div>
                  <div className="text-center p-2 rounded-xl bg-secondary/10 space-y-1">
                    <Egg className="w-4 h-4 text-accent/60 mx-auto" />
                    <p className="text-[8px] font-bold text-muted-foreground uppercase">Fat</p>
                    <p className="text-[11px] font-black">{avgDailyFats}g</p>
                  </div>
                  <div className="text-center p-2 rounded-xl bg-secondary/10 space-y-1">
                    <Droplets className="w-4 h-4 text-accent/60 mx-auto" />
                    <p className="text-[8px] font-bold text-muted-foreground uppercase">Water</p>
                    <p className="text-[11px] font-black">{avgDailyHydration}L</p>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground font-semibold bg-muted py-1.5 px-3 rounded-lg text-center mt-2">
                Total meals logged: <strong className="text-foreground">{monthlyMeals.length}</strong> items over <strong className="text-foreground">{uniqueDaysWithMeals.length}</strong> active days
              </p>
            </div>

            {/* 2. Fitness summary */}
            <div className="p-6 rounded-sm bg-card border border-border shadow-sm flex flex-col justify-between space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-border/40">
                <div className="p-1.5 rounded-xl bg-[#E3D6B8] text-[#6B5417]">
                  <Activity className="w-4 h-4" />
                </div>
                <h4 className="text-xs font-black uppercase tracking-wider text-foreground">Monthly Active</h4>
              </div>

              <div className="grid grid-cols-2 gap-4 flex-1 py-1">
                <div className="space-y-0.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">Workouts Done</p>
                  <p className="text-xl font-black text-foreground">{totalWorkoutsLogged}</p>
                  {totalWorkoutsLogged > 0 && (
                    <p className="text-[9px] text-muted-foreground"> {totalWorkoutCalBurned} kcal burned</p>
                  )}
                </div>

                <div className="space-y-0.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">Avg Daily Steps</p>
                  <p className="text-xl font-black text-amber-600 ">{avgDailySteps.toLocaleString()}</p>
                  <p className="text-[9px] text-muted-foreground"> Total: {totalSteps.toLocaleString()}</p>
                </div>

                <div className="space-y-0.5 col-span-2">
                  <div className="flex justify-between text-[10px] font-semibold text-muted-foreground uppercase pb-1">
                    <span>Active Time</span>
                    <span>{totalActiveMinutes} mins total</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="bg-yellow-500 h-full rounded-full" 
                      style={{ width: `${Math.min(100, (avgDailyActiveMinutes / 60) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[9px] text-muted-foreground pt-1">
                    Daily average: <strong className="text-foreground">{avgDailyActiveMinutes} mins/day</strong> (Target: 45 mins)
                  </p>
                </div>
              </div>
            </div>

            {/* 3. Sleep summary */}
            <div className="p-6 rounded-sm bg-card border border-border shadow-sm flex flex-col justify-between space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-border/40">
                <div className="p-1.5 rounded-xl bg-[#E8EAF6] text-[#3F51B5]">
                  <Moon className="w-4 h-4" />
                </div>
                <h4 className="text-xs font-black uppercase tracking-wider text-foreground">Sleep Patterns</h4>
              </div>

              <div className="space-y-4 flex-1 flex flex-col justify-center">
                <div className="flex justify-between items-center bg-primary/40  p-3 rounded-2xl">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" />
                    <span className="text-xs font-semibold text-foreground">Avg Duration</span>
                  </div>
                  <strong className="text-sm font-black text-primary ">{avgSleepDurationHours} hrs</strong>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px] font-bold text-muted-foreground uppercase">
                    <span>Average Quality</span>
                    <span className="text-primary font-extrabold">{avgSleepQuality}%</span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="bg-primary h-full rounded-full" 
                      style={{ width: `${avgSleepQuality}%` }}
                    />
                  </div>
                </div>
              </div>

              <p className="text-[9px] text-primary/80 font-black text-center mt-1">
                 Total sleep sessions tracked: {totalSleepLogs} nights this month
              </p>
            </div>

            {/* 4. Mood summary */}
            <div className="p-6 rounded-sm bg-card border border-border shadow-sm flex flex-col justify-between space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-border/40">
                <div className="p-1.5 rounded-xl bg-[#F3E5F5] text-[#9575CD]">
                  <Lightbulb className="w-4 h-4" />
                </div>
                <h4 className="text-xs font-black uppercase tracking-wider text-foreground">Mind & Balance</h4>
              </div>

              <div className="space-y-3 flex-1 flex flex-col justify-center">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-muted-foreground">Avg Mood Rating</span>
                  <div className="flex items-center gap-1">
                    <span className="font-black text-primary">{avgMoodIntensity} / 10</span>
                    <Lightbulb className="w-3.5 h-3.5 text-primary animate-pulse" />
                  </div>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-muted-foreground">Avg Energy Levels</span>
                  <strong className="font-black text-primary">{avgEnergyLevel} / 10</strong>
                </div>

                {settings.showCycleTracking && (
                  <div className="pt-2.5 border-t border-border/40 flex justify-between items-center text-xs mt-1">
                    <div className="flex items-center gap-1.5">
                      <Droplets className="w-3.5 h-3.5 text-rose-400 fill-current" />
                      <span className="font-semibold text-muted-foreground">Cycle Flow Days</span>
                    </div>
                    <strong className="font-black text-rose-600 ">{totalFlowDays} Flow Days</strong>
                  </div>
                )}
              </div>

              <p className="text-[9px] text-muted-foreground bg-primary/5 py-1.5 px-3 rounded-lg text-center font-bold">
                 Logged {totalMoodLogs} emotional reviews this month
              </p>
            </div>

          </div>
        )}
      </section>

      {/* Holistic Quote */}
      <section className="p-8 rounded-sm bg-secondary/30 border border-border/50 text-center space-y-4">
        <div className="p-4 rounded-full bg-secondary text-secondary-foreground w-fit mx-auto shadow-sm">
          <Heart className="w-8 h-8 text-primary" />
        </div>
        <div className="space-y-1">
          <h3 className="font-bold tracking-tight text-foreground">Your Holistic Snapshot</h3>
          <p className="text-xs text-muted-foreground font-semibold max-w-[280px] mx-auto leading-relaxed">
            Comparing monthly charts gives you insights into patterns connecting physical activity, sleep cycles, macros, and emotional balance.
          </p>
        </div>
      </section>
    </div>
  );
};

export default Health;
