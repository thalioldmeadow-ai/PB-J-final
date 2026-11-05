import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Circle, Plus, Clock, Flame, ChevronLeft, ChevronRight, Dumbbell, Heart, Trash2, Palette, ListTodo, Lightbulb } from '../components/icons';
import { cn } from '../lib/utils';
import { Task, Challenge, Meal, Workout } from '../types';
import { CHALLENGES } from '../constants';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import { useTheme } from '../components/ThemeProvider';
import { storage } from '../lib/storage';
import TaskEditModal from '../components/TaskEditModal';
import AiAssist from '../components/AiAssist';
import { loadPlanFacts } from '../lib/aiFacts';
import { addDays, format, isSameDay, isToday, startOfToday, startOfWeek } from 'date-fns';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useTheme();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [activeChallenge, setActiveChallenge] = useState<(Challenge & { currentTask?: string }) | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [slideDirection, setSlideDirection] = useState(1);
  const scheduleRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<boolean>(false);

  // Google Calendar Integration states is disabled
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [fetchingEvents, setFetchingEvents] = useState(false);
  const [showGCalToday, setShowGCalToday] = useState(false);

  const interval = settings.scheduleInterval || 30;
  const totalRows = Math.floor((12 * 60) / interval);
  const rowHeight = interval === 60 ? 80 : 
                   interval === 30 ? 60 :
                   interval === 15 ? 45 :
                   interval === 10 ? 40 : 35;
  const totalHeight = totalRows * rowHeight;

  const timeToMinutes = (timeStr: string = '09:00 AM') => {
    try {
      const [time, ampm] = timeStr.split(' ');
      let [hours, minutes] = time.split(':').map(Number);
      if (ampm.toUpperCase() === 'PM' && hours < 12) hours += 12;
      if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
      return hours * 60 + minutes;
    } catch (e) {
      return 0;
    }
  };

  // Helper formatting for GCal event times
  const formatGCalTime = (isoString?: string) => {
    if (!isoString) return '09:00 AM';
    const date = new Date(isoString);
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  const getEventDuration = (startIso?: string, endIso?: string) => {
    if (!startIso || !endIso) return 30;
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    const diffMin = Math.round((end - start) / 60000);
    return Math.max(15, diffMin);
  };

  // Tasks saved before dates were tracked are treated as today's.
  const getTaskDate = (task: Task) => {
    const parsed = task.date ? new Date(task.date) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : startOfToday();
  };

  // Everything on this screen is scoped to the day currently being viewed.
  const dayTasks = tasks.filter(t => isSameDay(getTaskDate(t), selectedDate));
  const dayMeals = meals.filter(m => isSameDay(new Date(m.date), selectedDate));
  const dayWorkouts = workouts.filter(w => isSameDay(new Date(w.date), selectedDate));
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    addDays(startOfWeek(selectedDate, { weekStartsOn: 1 }), i),
  );
  const dayHasItems = (day: Date) =>
    tasks.some(t => isSameDay(getTaskDate(t), day)) ||
    meals.some(m => isSameDay(new Date(m.date), day)) ||
    workouts.some(w => isSameDay(new Date(w.date), day));

  const goToDay = (offset: number) => {
    setSlideDirection(offset > 0 ? 1 : -1);
    setSelectedDate(prev => addDays(prev, offset));
  };

  // Swipe handling for the day strip (works with touch and trackpad/mouse drags).
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipedRef = useRef(false);

  const handleStripPointerDown = (event: React.PointerEvent) => {
    swipeStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleStripPointerUp = (event: React.PointerEvent) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
    swipedRef.current = true;
    goToDay(dx < 0 ? 1 : -1);
    window.setTimeout(() => {
      swipedRef.current = false;
    }, 300);
  };

  const scheduleTasks = dayTasks
    .filter(t => t.type === 'timeblock' || Boolean(t.time))
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  // Google Calendar Integration disabled
  const mergedScheduleTasks = [...scheduleTasks].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  useEffect(() => {
    const unsubTasks = storage.subscribe(storage.key.TASKS, (data) => {
      const taskList = data as Task[];
      taskList.sort((a, b) => {
        if (a.type === 'timeblock' && b.type === 'timeblock') {
          return timeToMinutes(a.time) - timeToMinutes(b.time);
        }
        return (a.order || 0) - (b.order || 0);
      });
      setTasks(taskList);
    }, user?.uid);

    const unsubChallenges = storage.subscribe(storage.key.ACTIVE_CHALLENGES, (data) => {
      const activeArr = (data as Challenge[]).filter(c => c.active);
      if (activeArr.length > 0) {
        const challengeData = activeArr[0];
        const fullChallenge = CHALLENGES.find(c => c.id === challengeData.challengeId);
        const currentDay = (challengeData.completedDays?.length || 0) + 1;
        const currentTask = fullChallenge?.days.find(d => d.dayNumber === currentDay)?.task;
        
        setActiveChallenge({ 
          ...challengeData,
          currentTask
        });
      } else {
        setActiveChallenge(null);
      }
    }, user?.uid);

    const unsubMeals = storage.subscribe(storage.key.MEALS, (data) => {
      setMeals(data as Meal[]);
    }, user?.uid);

    const unsubWorkouts = storage.subscribe(storage.key.WORKOUTS, (data) => {
      setWorkouts(data as Workout[]);
    }, user?.uid);

    return () => {
      unsubTasks();
      unsubChallenges();
      unsubMeals();
      unsubWorkouts();
    };
  }, [user?.uid]);

  const toggleTask = async (task: Task) => {
    try {
      await storage.update(storage.key.TASKS, task.id, { completed: !task.completed });
    } catch (error) {
      console.error('Error toggling task:', error);
    }
  };

  const addTask = async () => {
    try {
      const newTask = {
        uid: user?.uid || 'guest',
        title: 'New Task',
        completed: false,
        date: selectedDate.toISOString(),
        order: tasks.length,
        type: 'todo'
      };
      const id = await storage.add(storage.key.TASKS, newTask);
      setEditingTask({ id, ...newTask } as Task);
    } catch (error) {
      console.error("Error adding task:", error);
    }
  };

  const addTimeblock = async () => {
    try {
      const newTask = {
        uid: user?.uid || 'guest',
        title: 'New Event',
        completed: false,
        date: selectedDate.toISOString(),
        order: tasks.filter(t => t.type === 'timeblock').length,
        type: 'timeblock',
        time: '09:00 AM',
        color: '#C7AF94', // Sand
        duration: 30,
        subtasks: []
      };
      const id = await storage.add(storage.key.TASKS, newTask);
      setEditingTask({ id, ...newTask } as Task);
    } catch (error) {
      console.error("Error adding timeblock:", error);
    }
  };

  const completeChallengeDay = async () => {
    if (!activeChallenge) return;
    
    // Just add the next day
    const nextDay = (activeChallenge.completedDays?.length || 0) + 1;
    
    if (!activeChallenge.completedDays?.includes(nextDay)) {
      try {
        await storage.update(storage.key.ACTIVE_CHALLENGES, activeChallenge.id, {
          completedDays: [...(activeChallenge.completedDays || []), nextDay]
        });
      } catch (error) {
        console.error("Error updating challenge:", error);
      }
    }
  };

  const moveToSchedule = async (task: Task, specificTime?: string, shouldEdit: boolean = true) => {
    try {
      const updates = {
        type: 'timeblock' as const,
        time: specificTime || '09:00 AM',
        order: tasks.filter(t => t.type === 'timeblock').length,
        color: '#C7AF94', // Sand
        duration: 30,
        subtasks: []
      };
      await storage.update(storage.key.TASKS, task.id, updates);
      if (shouldEdit) {
        setEditingTask({ ...task, ...updates } as Task);
      }
    } catch (error) {
      console.error('Error moving task to schedule:', error);
    }
  };

  const dragOffsetRef = useRef<number>(0);

  const updateTask = async (taskId: string, updates: Partial<Task>) => {
    try {
      await storage.update(storage.key.TASKS, taskId, updates);
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      await storage.delete(storage.key.TASKS, taskId);
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Day Switcher, tap a day, or swipe the strip left/right */}
      <section className="space-y-3 select-none">
        <div className="flex justify-between items-center">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-primary">
              {isToday(selectedDate) ? 'Today' : format(selectedDate, 'EEEE')}
            </h2>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {format(selectedDate, 'd MMM yyyy')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {!isToday(selectedDate) && (
              <button
                onClick={() => {
                  setSlideDirection(-1);
                  setSelectedDate(startOfToday());
                }}
                className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest text-primary bg-primary/10 hover:bg-primary/20 transition-all"
              >
                Today
              </button>
            )}
            <button
              onClick={() => goToDay(-1)}
              aria-label="Previous day"
              className="p-1.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => goToDay(1)}
              aria-label="Next day"
              className="p-1.5 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div
          onPointerDown={handleStripPointerDown}
          onPointerUp={handleStripPointerUp}
          onPointerCancel={() => {
            swipeStartRef.current = null;
          }}
          className="grid grid-cols-7 gap-1 p-1.5 rounded-sm bg-card border border-border shadow-sm cursor-grab active:cursor-grabbing touch-pan-y"
        >
          {weekDays.map((day) => {
            const isSelected = isSameDay(day, selectedDate);
            const dayIsToday = isToday(day);
            return (
              <button
                key={day.toISOString()}
                onClick={() => {
                  if (swipedRef.current || isSelected) return;
                  setSlideDirection(day > selectedDate ? 1 : -1);
                  setSelectedDate(day);
                }}
                aria-pressed={isSelected}
                className={cn(
                  "relative flex flex-col items-center gap-1 py-2 rounded-2xl transition-all",
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:bg-primary/5"
                )}
              >
                <span className={cn(
                  "text-[8px] font-black uppercase tracking-widest",
                  isSelected ? "text-primary-foreground/80" : "text-muted-foreground/60"
                )}>
                  {format(day, 'EEEEE')}
                </span>
                <span className={cn(
                  "text-sm font-bold",
                  isSelected
                    ? "text-primary-foreground"
                    : dayIsToday ? "text-primary" : "text-foreground/70"
                )}>
                  {format(day, 'd')}
                </span>
                <span className={cn(
                  "w-1 h-1 rounded-full",
                  dayHasItems(day)
                    ? isSelected ? "bg-primary-foreground/70" : "bg-primary/60"
                    : "bg-transparent"
                )} />
              </button>
            );
          })}
        </div>
      </section>

      <AiAssist
        title="Plan today"
        description="Works from your real tasks, overdue items and goals. Any task it suggests is only added after you confirm."
        mode="planning"
        allowActions={['createTask', 'updateTask', 'createGoal']}
        suggestions={[
          { label: 'What first?', prompt: 'Given what I have today, what should I do first and why?' },
          { label: 'Sort my day', prompt: 'Help me order today realistically and move what will not fit.' },
          { label: 'Add a task', prompt: 'Add a task to call the dentist tomorrow.' },
        ]}
        context={async () => ({ plan: await loadPlanFacts() })}
      />

      <motion.div
        key={format(selectedDate, 'yyyy-MM-dd')}
        initial={{ opacity: 0, x: slideDirection * 28 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="space-y-8"
      >
      {/* Horizontal To-Do List */}
      <section className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold tracking-tight text-primary">
            {isToday(selectedDate) ? "Today's Focus" : `${format(selectedDate, 'EEEE')}'s Focus`}
          </h2>
          <button 
            onClick={addTask}
            aria-label="Add task"
            className="text-primary hover:text-primary/80 p-1 rounded-full hover:bg-primary/10 transition-all"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x">
          {/* Meal Plan Card (Integrated into Focus) */}
          <Link to="/plan?tab=meals" className="flex-shrink-0 w-64 snap-start">
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="h-full p-5 rounded-3xl bg-primary/10 border border-primary/20 shadow-sm space-y-3"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Heart className="w-4 h-4 text-primary" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Meal Plan</span>
                </div>
                <div className="flex items-center gap-1">
                  <button 
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      navigate(`/add-meal?date=${selectedDate.toISOString()}`);
                    }}
                    className="p-1.5 rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-all"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <ChevronRight className="w-4 h-4 text-primary/40" />
                </div>
              </div>
              
              <div className="space-y-2">
                {['breakfast', 'lunch', 'dinner'].map(type => {
                  const meal = dayMeals.find(m => m.type === type);
                  return (
                    <div key={type} className="flex items-center gap-2">
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        meal ? "bg-primary" : "bg-muted-foreground/20"
                      )} />
                      <span className="text-[10px] font-bold uppercase tracking-tighter text-muted-foreground w-16">{type}</span>
                      <span className={cn(
                        "text-xs font-medium truncate",
                        meal ? "text-foreground" : "text-muted-foreground/40 italic"
                      )}>
                        {meal ? meal.name : "Not planned"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </Link>

          {/* Movement Card (Workout plan for the selected day) */}
          <Link to="/plan?tab=workouts" className="flex-shrink-0 w-64 snap-start">
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="h-full p-5 rounded-3xl bg-secondary/30 border border-secondary/50 shadow-sm space-y-3"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Dumbbell className="w-4 h-4 text-secondary" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-secondary">Movement</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      navigate(`/add-workout?type=strength&date=${selectedDate.toISOString()}`);
                    }}
                    className="p-1.5 rounded-full bg-secondary/20 text-secondary hover:bg-secondary/30 transition-all"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <ChevronRight className="w-4 h-4 text-secondary/40" />
                </div>
              </div>

              <div className="space-y-2">
                {dayWorkouts.length > 0 ? (
                  dayWorkouts.slice(0, 3).map((workout) => (
                    <div key={workout.id} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary" />
                      <span className="text-xs font-medium truncate text-foreground">{workout.name}</span>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20" />
                    <span className="text-xs font-medium text-muted-foreground/40 italic">Nothing planned</span>
                  </div>
                )}
              </div>
            </motion.div>
          </Link>

              {dayTasks.filter(t => t.type === 'todo' || !t.type).map((task) => (
                <motion.div
                  key={task.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={cn(
                    "flex-shrink-0 w-48 p-4 rounded-3xl border border-border snap-start transition-all duration-300 cursor-pointer",
                    task.completed ? "bg-muted/50 border-transparent" : "bg-card shadow-sm"
                  )}
                  onClick={() => toggleTask(task)}
                >
                  <div className="flex justify-between items-start mb-3">
                    {task.completed ? (
                      <CheckCircle2 className="w-6 h-6 text-primary fill-primary/20" />
                    ) : (
                      <Circle className="w-6 h-6 text-muted-foreground" />
                    )}
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">{task.type || 'todo'}</span>
                  </div>
                  <p className={cn(
                    "font-medium leading-tight",
                    task.completed && "line-through text-muted-foreground"
                  )}>
                    {task.title}
                  </p>
                  
                  {!task.completed && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        moveToSchedule(task, '09:00 AM', true);
                      }}
                      className="mt-3 w-full py-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-[9px] font-bold uppercase tracking-wider transition-all"
                    >
                      Schedule Task +
                    </button>
                  )}
                </motion.div>
              ))}
          
          <button 
            onClick={addTask}
            aria-label="Add task"
            className="flex-shrink-0 w-48 p-4 rounded-3xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 hover:border-primary/50 hover:bg-primary/5 transition-all text-muted-foreground hover:text-primary"
          >
            <Plus className="w-6 h-6" />
            <span className="text-xs font-medium">Add Task</span>
          </button>
        </div>
      </section>

      {/* Your Schedule Section */}
      <section className="space-y-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-secondary" />
            <h2 className="text-lg font-semibold tracking-tight text-primary">Your Schedule</h2>
          </div>
          <button 
            onClick={addTimeblock}
            aria-label="Add time block"
            className="p-2 rounded-full bg-secondary text-secondary-foreground transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div 
          ref={scheduleRef}
          className="relative rounded-sm border border-border bg-secondary shadow-inner h-[500px] overflow-y-auto scrollbar-hide"
        >
          {/* Time Grid Lines */}
          <div className="absolute top-0 left-0 w-full pointer-events-none" style={{ height: `${totalHeight}px` }}>
            {[...Array(totalRows)].map((_, i) => {
              const totalMinutes = i * interval;
              const hour = Math.floor(totalMinutes / 60) + 8;
              const minutes = totalMinutes % 60;
              const displayHour = hour > 12 ? hour - 12 : hour;
              const ampm = hour >= 12 ? 'pm' : 'am';
              const timeStr = `${displayHour}:${minutes.toString().padStart(2, '0')} ${ampm}`;
              
              return (
                <div 
                  key={i} 
                  className="w-full border-b border-foreground/10 flex items-start"
                  style={{ height: `${rowHeight}px` }}
                >
                  <span className="text-[8px] font-bold text-foreground/30 ml-4 mt-1">
                    {timeStr}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Schedule Items */}
          <div className="relative z-10 pl-20" style={{ height: `${totalHeight}px` }}>
            <AnimatePresence mode="popLayout">
                 {mergedScheduleTasks.map((block: any) => {
                  const minutesFrom8AM = timeToMinutes(block.time) - 8 * 60;
                  const topPosition = (minutesFrom8AM / interval) * rowHeight;
                  const currentDuration = block.duration || 30;
                  const height = (currentDuration / interval) * rowHeight;

                  return (
                    <motion.div
                      key={block.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ 
                        opacity: 1, 
                        scale: 1, 
                        top: topPosition, 
                        height: height - 2,
                        zIndex: 10
                      }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      onClick={() => {
                        if (block.isGoogleCalendar && block.htmlLink) {
                          window.open(block.htmlLink, '_blank');
                        } else {
                          setEditingTask(block);
                        }
                      }}
                      style={{ 
                        position: 'absolute',
                        left: '80px',
                        right: '16px',
                        top: topPosition,
                        height: height,
                        backgroundColor: block.completed 
                          ? (settings.theme === 'dark' ? '#374151' : '#E5E7EB')
                          : (block.isGoogleCalendar ? '#4F46E5' : (block.color?.startsWith('#') ? block.color : undefined))
                      }}
                      className={cn(
                        "group flex flex-col p-3 rounded-2xl border transition-all duration-300 cursor-pointer overflow-hidden shadow-lg",
                        block.completed
                          ? "border-black/5  opacity-80"
                          : block.isGoogleCalendar 
                            ? "border-primary/40 text-primary-foreground shadow-primary/10"
                            : "border-border shadow-lg",
                        (!block.completed && !block.isGoogleCalendar && (!block.color || !block.color.startsWith('#'))) && (block.color || 'bg-moss/80'),
                      )}
                    >
                      <div className="flex-1 min-w-0 w-full">
                        <div className="flex items-center justify-between mb-0.5 animate-in fade-in duration-300">
                          <div className="flex items-center gap-2">
                            {block.isGoogleCalendar ? (
                              <div className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider text-primary bg-card shadow-sm flex items-center justify-center">
                                Google Event
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  toggleTask(block);
                                }}
                                className="p-1 rounded-full cursor-pointer hover:bg-black/10 :bg-card/10 transition-colors z-30"
                              >
                                {block.completed ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600  fill-emerald-100 " />
                                ) : (
                                  <Circle className={cn(
                                    "w-4 h-4",
                                    ['#95714F', '#8C916C', '#4A3728', '#A69076', '#7D8461', '#C7AF94', '#9E9E8C'].includes(block.color || '') ? "text-primary-foreground/50 hover:text-primary-foreground" : "text-black/30 hover:text-black"
                                  )} />
                                )}
                              </button>
                            )}

                            <span className={cn(
                              "text-[8px] font-black uppercase",
                              block.completed
                                ? "text-muted-foreground/50"
                                : block.isGoogleCalendar
                                  ? "text-primary"
                                  : ['#95714F', '#8C916C', '#4A3728', '#A69076', '#7D8461', '#C7AF94', '#9E9E8C'].includes(block.color || '') ? "text-primary-foreground/80" : "text-black/60"
                            )}>
                              {block.time || '09:00 am'} {currentDuration ? `• ${currentDuration}m` : ''}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className={cn(
                            "font-bold text-xs truncate",
                            block.completed
                              ? "line-through text-muted-foreground/50"
                              : block.isGoogleCalendar
                                ? "text-primary-foreground font-semibold"
                                : ['#95714F', '#8C916C', '#4A3728', '#A69076', '#7D8461', '#C7AF94', '#9E9E8C'].includes(block.color || '') ? "text-primary-foreground" : "text-black/80"
                          )}>{block.title}</p>
                          {block.subtasks && block.subtasks.length > 0 && (
                            <div className={cn(
                              "flex items-center gap-1 text-[7px] font-bold uppercase tracking-widest",
                              block.completed
                                ? "text-muted-foreground/45"
                                : ['#95714F', '#8C916C', '#4A3728', '#A69076', '#7D8461', '#C7AF94', '#9E9E8C'].includes(block.color || '') ? "text-primary-foreground/60" : "text-black/40"
                            )}>
                              <ListTodo className="w-2 h-2" />
                              {block.subtasks.filter(s => s.completed).length}/{block.subtasks.length}
                            </div>
                          )}
                        </div>
                        {block.isGoogleCalendar && block.description && (
                          <span className="text-[9px] text-primary line-clamp-1 break-all mt-0.5 italic block w-full">
                            {block.description}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                 })}
            </AnimatePresence>
          </div>
        </div>
      </section>
      </motion.div>

      {/* Active Challenge Card */}
      <section className="pt-4">
        {activeChallenge ? (
          <div className="relative">
            <Link to="/challenges">
              <motion.div
                whileHover={{ y: -4 }}
                className="relative overflow-hidden p-6 rounded-sm bg-card border-primary/30 border border-primary/20 shadow-xl shadow-primary/5"
              >
                <div className="absolute right-4 top-4 opacity-10">
                  <Flame className="w-16 h-16 text-primary" />
                </div>
                
                <div className="relative z-10 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-full bg-primary/20 text-primary">
                        <Flame className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Active Challenge</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-secondary" />
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-xl font-bold tracking-tight text-foreground">{activeChallenge.title}</h3>
                    <p className="text-sm text-secondary font-medium">Day {activeChallenge.completedDays.length + 1}: {activeChallenge.currentTask || 'Keep going!'}</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-end text-[10px] font-bold uppercase tracking-tighter">
                      <span className="text-primary">Progress</span>
                      <span className="text-secondary">{activeChallenge.completedDays.length} / 30 Days</span>
                    </div>
                    <div className="h-2 w-full bg-background/50 rounded-full overflow-hidden border border-border/50">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(activeChallenge.completedDays.length / 30) * 100}%` }}
                        className="h-full bg-primary"
                        transition={{ duration: 1, ease: "easeOut" }}
                      />
                    </div>
                  </div>
                  
                  {/* Spacer for button */}
                  <div className="h-12" />
                </div>
              </motion.div>
            </Link>
            
            <div className="absolute bottom-6 left-6 right-6 z-20">
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  completeChallengeDay();
                }}
                className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all "
              >
                Complete Today's Task
              </button>
            </div>
          </div>
        ) : (
          <Link to="/challenges">
            <div className="p-8 rounded-sm border-2 border-dashed border-border flex flex-col items-center justify-center gap-4 text-center hover:bg-muted/50 transition-all">
              <div className="p-4 rounded-full bg-muted text-muted-foreground">
                <Flame className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold tracking-tight">No Active Challenge</h3>
                <p className="text-xs text-muted-foreground font-medium">Start a 30-day challenge to build better habits.</p>
              </div>
              <button className="px-6 py-2 rounded-full bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest">
                Browse Challenges
              </button>
            </div>
          </Link>
        )}
      </section>

      {/* Support Options Section */}
      <section className="space-y-6 pt-6 border-t border-border mt-12 mb-6">
        <div className="space-y-1">
          <h2 className="text-sm font-extrabold uppercase tracking-widest text-[#8A7355]">Support Options</h2>
          <p className="text-xs text-muted-foreground">If you're feeling overwhelmed, these free Australian resources are here to help you 24/7.</p>
        </div>

        <div className="space-y-4">
          {[
            {
              name: "Lifeline",
              phone: "13 11 14",
              phoneUrl: "131114",
              website: "lifeline.org.au",
              bestFor: "Immediate crisis support, suicide prevention, and emotional distress."
            },
            {
              name: "Beyond Blue",
              phone: "1300 22 4636",
              phoneUrl: "1300224636",
              website: "beyondblue.org.au",
              bestFor: "Support with depression, anxiety, everyday stress, and peer community forums."
            },
            {
              name: "Kids Helpline",
              phone: "1800 55 1800",
              phoneUrl: "1800551800",
              website: "kidshelpline.com.au",
              bestFor: "Free, private counselling for young people aged 5 to 25."
            },
            {
              name: "Suicide Call Back Service",
              phone: "1300 659 467",
              phoneUrl: "1300659467",
              website: "suicidecallbackservice.org.au",
              bestFor: "Immediate professional 24/7 telephone and online counselling."
            }
          ].map((srv, i) => (
            <div key={i} className="p-5 rounded-3xl bg-secondary/30 border border-border/40 hover:border-primary/20 transition-all space-y-3">
              <div className="flex flex-wrap justify-between items-start gap-2">
                <h3 className="font-bold text-sm text-foreground">{srv.name}</h3>
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/5 px-2 py-1 rounded">24/7 Available</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-medium">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="font-bold uppercase tracking-widest text-[9px] text-muted-foreground/50">Phone:</span>
                  <a href={`tel:${srv.phoneUrl}`} className="text-primary hover:underline font-bold text-sm">{srv.phone}</a>
                </div>
                <div className="flex items-start sm:items-center gap-1.5 text-muted-foreground min-w-0">
                  <span className="font-bold uppercase tracking-widest text-[9px] text-muted-foreground/50 mt-1 sm:mt-0 flex-shrink-0">Website:</span>
                  <a href={`https://${srv.website}`} target="_blank" rel="noopener noreferrer" className="text-[#8A7355] hover:underline font-bold break-all">{srv.website}</a>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-bold uppercase tracking-widest text-[9px] text-muted-foreground/42 block mb-0.5">Best for:</span>
                {srv.bestFor}
              </p>
            </div>
          ))}
        </div>
      </section>

      <AnimatePresence>
        {editingTask && (
          <TaskEditModal
            task={editingTask}
            onClose={() => setEditingTask(null)}
            onSave={(updates) => updateTask(editingTask.id, updates)}
            onDelete={deleteTask}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default Home;
