import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Dumbbell,
  Plus,
  Utensils,
} from './icons';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfToday,
  startOfWeek,
} from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { storage } from '../lib/storage';
import { Task, Meal, Workout } from '../types';
import TaskEditModal from './TaskEditModal';
import { useAuth } from './AuthProvider';

type CalendarViewMode = 'day' | 'week' | 'month';

interface CalendarViewProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

const WEEK_STARTS_ON = 1; // Monday, matching the Home day strip
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 20;
const HOUR_HEIGHT = 80;

const formatHourLabel = (hour: number) => {
  const displayHour = hour % 12 || 12;
  return `${displayHour} ${hour >= 12 ? 'pm' : 'am'}`;
};

const timeToMinutes = (timeStr: string = '09:00 AM') => {
  try {
    const [time, ampm] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (ampm?.toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (ampm?.toUpperCase() === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  } catch {
    return 0;
  }
};

/**
 * Big overall calendar for the Plan screen: day, week and month views over the
 * same records Home uses, tasks/timeblocks, meals and workouts, so anything
 * added in either place shows up in both.
 */
const CalendarView: React.FC<CalendarViewProps> = ({ selectedDate, onSelectDate }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [view, setView] = useState<CalendarViewMode>('month');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  useEffect(() => {
    const unsubTasks = storage.subscribe(storage.key.TASKS, (data) => setTasks(data as Task[]), user?.uid);
    const unsubMeals = storage.subscribe(storage.key.MEALS, (data) => setMeals(data as Meal[]), user?.uid);
    const unsubWorkouts = storage.subscribe(storage.key.WORKOUTS, (data) => setWorkouts(data as Workout[]), user?.uid);
    return () => {
      unsubTasks();
      unsubMeals();
      unsubWorkouts();
    };
  }, [user?.uid]);

  // Tasks saved before dates were tracked are treated as today's.
  const taskDate = (task: Task) => {
    const parsed = task.date ? new Date(task.date) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : startOfToday();
  };

  const itemsForDay = (day: Date) => {
    const dayTasks = tasks.filter(t => isSameDay(taskDate(t), day));
    const dayMeals = meals.filter(m => isSameDay(new Date(m.date), day));
    const dayWorkouts = workouts.filter(w => isSameDay(new Date(w.date), day));
    return {
      tasks: dayTasks,
      meals: dayMeals,
      workouts: dayWorkouts,
      total: dayTasks.length + dayMeals.length + dayWorkouts.length,
    };
  };

  const shift = (direction: number) => {
    if (view === 'day') onSelectDate(addDays(selectedDate, direction));
    else if (view === 'week') onSelectDate(addWeeks(selectedDate, direction));
    else onSelectDate(addMonths(selectedDate, direction));
  };

  const headerLabel =
    view === 'day'
      ? format(selectedDate, 'EEEE, d MMM yyyy')
      : view === 'week'
        ? `${format(startOfWeek(selectedDate, { weekStartsOn: WEEK_STARTS_ON }), 'd MMM')} – ${format(
            endOfWeek(selectedDate, { weekStartsOn: WEEK_STARTS_ON }),
            'd MMM yyyy',
          )}`
        : format(selectedDate, 'MMMM yyyy');

  const monthStart = startOfMonth(selectedDate);
  const monthDays = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON }),
    end: endOfWeek(endOfMonth(monthStart), { weekStartsOn: WEEK_STARTS_ON }),
  });
  const weekDays = eachDayOfInterval({
    start: startOfWeek(selectedDate, { weekStartsOn: WEEK_STARTS_ON }),
    end: endOfWeek(selectedDate, { weekStartsOn: WEEK_STARTS_ON }),
  });

  const addTaskOn = async (day: Date) => {
    const newTask = {
      uid: user?.uid || 'guest',
      title: 'New Task',
      completed: false,
      date: day.toISOString(),
      order: tasks.length,
      type: 'todo' as const,
    };
    try {
      const id = await storage.add(storage.key.TASKS, newTask);
      setEditingTask({ id, ...newTask } as Task);
    } catch (error) {
      console.error('Error adding task from calendar:', error);
    }
  };

  const updateTask = async (taskId: string, updates: Partial<Task>) => {
    try {
      await storage.update(storage.key.TASKS, taskId, updates);
    } catch (error) {
      console.error('Error updating task from calendar:', error);
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      await storage.delete(storage.key.TASKS, taskId);
    } catch (error) {
      console.error('Error deleting task from calendar:', error);
    }
  };

  const renderDayDot = (kind: 'task' | 'meal' | 'workout', selected: boolean) => (
    <span
      className={cn(
        'w-1 h-1 rounded-full',
        selected
          ? 'bg-primary-foreground/80'
          : kind === 'task'
            ? 'bg-primary'
            : kind === 'meal'
              ? 'bg-rose-400'
              : 'bg-sky-400',
      )}
    />
  );

  const renderMonth = () => (
    <div className="p-3 rounded-sm bg-card border border-border shadow-sm">
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => (
          <div key={i} className="text-center text-[9px] font-bold text-muted-foreground/40 py-1">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {monthDays.map((day) => {
          const isSelected = isSameDay(day, selectedDate);
          const inMonth = isSameMonth(day, monthStart);
          const items = itemsForDay(day);
          return (
            <button
              key={day.toISOString()}
              onClick={() => onSelectDate(day)}
              aria-label={format(day, 'EEEE d MMMM yyyy')}
              aria-pressed={isSelected}
              className={cn(
                'aspect-square rounded-xl flex flex-col items-center justify-center gap-1 transition-all',
                isSelected
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                  : isToday(day)
                    ? 'bg-primary/10 text-primary'
                    : inMonth
                      ? 'hover:bg-muted text-foreground'
                      : 'text-muted-foreground/30',
              )}
            >
              <span className="text-[11px] font-bold leading-none">{format(day, 'd')}</span>
              <span className="flex items-center gap-0.5 h-1">
                {items.tasks.length > 0 && renderDayDot('task', isSelected)}
                {items.meals.length > 0 && renderDayDot('meal', isSelected)}
                {items.workouts.length > 0 && renderDayDot('workout', isSelected)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderWeek = () => (
    <div className="rounded-sm bg-card border border-border shadow-sm divide-y divide-border/60 overflow-hidden">
      {weekDays.map((day) => {
        const items = itemsForDay(day);
        const chips = [
          ...items.tasks.map(t => ({ id: t.id, label: t.title, kind: 'task' as const })),
          ...items.meals.map(m => ({ id: m.id, label: m.name, kind: 'meal' as const })),
          ...items.workouts.map(w => ({ id: w.id, label: w.name, kind: 'workout' as const })),
        ];
        return (
          <button
            key={day.toISOString()}
            onClick={() => {
              onSelectDate(day);
              setView('day');
            }}
            className={cn(
              'w-full flex items-start gap-3 p-3 text-left transition-all',
              isSameDay(day, selectedDate) ? 'bg-primary/10' : 'hover:bg-muted/40',
            )}
          >
            <div className="w-9 flex-shrink-0 text-center">
              <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/60">
                {format(day, 'EEE')}
              </p>
              <p className={cn('text-lg font-bold leading-tight', isToday(day) ? 'text-primary' : 'text-foreground/80')}>
                {format(day, 'd')}
              </p>
            </div>

            <div className="flex-1 min-w-0 pt-0.5">
              {chips.length === 0 ? (
                <span className="text-[10px] italic text-muted-foreground/40">Nothing planned</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {chips.slice(0, 3).map(chip => (
                    <span
                      key={`${chip.kind}-${chip.id}`}
                      className={cn(
                        'max-w-[130px] truncate px-2 py-0.5 rounded-full text-[9px] font-bold',
                        chip.kind === 'task'
                          ? 'bg-primary/10 text-primary'
                          : chip.kind === 'meal'
                            ? 'bg-rose-500/10 text-rose-600 '
                            : 'bg-sky-500/10 text-sky-600 ',
                      )}
                    >
                      {chip.label}
                    </span>
                  ))}
                  {chips.length > 3 && (
                    <span className="px-2 py-0.5 rounded-full bg-muted text-[9px] font-bold text-muted-foreground">
                      +{chips.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );

  const renderDay = () => {
    const items = itemsForDay(selectedDate);
    const events = items.tasks
      .filter(t => t.type === 'timeblock' || Boolean(t.time))
      .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
    const todos = items.tasks.filter(t => t.type !== 'timeblock' && !t.time);
    const empty = items.total === 0;

    // Hourly rows, always. The grid grows only when an event falls outside 8am to 8pm.
    const eventMinutes = events.map(event => timeToMinutes(event.time));
    const earliestStart = eventMinutes.length ? Math.min(...eventMinutes) : DAY_START_HOUR * 60;
    const latestEnd = events.length
      ? Math.max(...events.map(event => timeToMinutes(event.time) + Math.max(event.duration || 30, 15)))
      : DAY_END_HOUR * 60;
    const gridStartHour = Math.max(0, Math.min(DAY_START_HOUR, Math.floor(earliestStart / 60)));
    const gridEndHour = Math.min(24, Math.max(DAY_END_HOUR, Math.ceil(latestEnd / 60)));
    const hours = Array.from({ length: gridEndHour - gridStartHour }, (_, i) => gridStartHour + i);
    const gridHeight = hours.length * HOUR_HEIGHT;

    return (
      <div className="rounded-sm bg-card border border-border shadow-sm p-4 space-y-5">
        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Schedule</p>
          <div className="relative rounded-2xl border border-border/60 bg-background/40 h-[460px] overflow-y-auto scrollbar-hide">
            <div className="relative" style={{ height: `${gridHeight}px` }}>
              <div className="absolute inset-0 pointer-events-none">
                {hours.map(hour => (
                  <div
                    key={hour}
                    className="absolute left-0 right-0 border-t border-border/50"
                    style={{ top: `${(hour - gridStartHour) * HOUR_HEIGHT}px` }}
                  >
                    <span className="absolute top-1 left-2 px-1 bg-background/40 text-[8px] font-bold uppercase tracking-wider text-muted-foreground/50">
                      {formatHourLabel(hour)}
                    </span>
                  </div>
                ))}
                <div className="absolute bottom-0 left-0 right-0 border-t border-border/50" />
              </div>

              <div className="absolute inset-y-0 left-14 right-2">
                {events.map(event => {
                  const top = ((timeToMinutes(event.time) - gridStartHour * 60) / 60) * HOUR_HEIGHT;
                  const height = Math.max((Math.max(event.duration || 30, 15) / 60) * HOUR_HEIGHT, 38);
                  const hasColor = Boolean(event.color?.startsWith('#'));

                  return (
                    <div
                      key={event.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setEditingTask(event)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') setEditingTask(event);
                      }}
                      className={cn(
                        'absolute left-0 right-0 z-10 flex items-start gap-2 p-2 rounded-xl border text-left cursor-pointer overflow-hidden transition-all',
                        event.completed ? 'bg-muted/60 border-transparent opacity-70' : 'shadow-sm',
                        !event.completed && !hasColor && 'bg-primary/10 border-primary/30',
                      )}
                      style={{
                        top: `${top}px`,
                        height: `${height - 2}px`,
                        ...(hasColor && !event.completed
                          ? { backgroundColor: `${event.color}33`, borderColor: `${event.color}88` }
                          : {}),
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateTask(event.id, { completed: !event.completed });
                        }}
                        className="flex-shrink-0 mt-0.5"
                        aria-label={event.completed ? 'Mark as not done' : 'Mark as done'}
                      >
                        {event.completed ? (
                          <CheckCircle2 className="w-4 h-4 text-primary fill-primary/20" />
                        ) : (
                          <Circle className="w-4 h-4 text-muted-foreground" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-[11px] font-bold truncate leading-tight', event.completed && 'line-through text-muted-foreground')}>
                          {event.title}
                        </p>
                        <p className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1 mt-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {event.time || '09:00 AM'}
                          {event.duration ? ` • ${event.duration}m` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {todos.length > 0 && (
          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Tasks</p>
            {todos.map(task => (
              <div
                key={task.id}
                className="flex items-center gap-3 p-3 rounded-2xl bg-muted/30 border border-border/40"
              >
                <button
                  type="button"
                  onClick={() => updateTask(task.id, { completed: !task.completed })}
                  className="flex-shrink-0"
                  aria-label={task.completed ? 'Mark as not done' : 'Mark as done'}
                >
                  {task.completed ? (
                    <CheckCircle2 className="w-5 h-5 text-primary fill-primary/20" />
                  ) : (
                    <Circle className="w-5 h-5 text-muted-foreground" />
                  )}
                </button>
                <button
                  onClick={() => setEditingTask(task)}
                  className={cn(
                    'flex-1 min-w-0 text-left text-xs font-medium truncate',
                    task.completed && 'line-through text-muted-foreground',
                  )}
                >
                  {task.title}
                </button>
              </div>
            ))}
          </div>
        )}

        {items.meals.length > 0 && (
          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Meals</p>
            {items.meals.map(meal => (
              <button
                key={meal.id}
                onClick={() => navigate(`/meal/${meal.id}`)}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-left"
              >
                <Utensils className="w-4 h-4 text-rose-500 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold truncate">{meal.name}</p>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-rose-500/70">{meal.type}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {items.workouts.length > 0 && (
          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Workouts</p>
            {items.workouts.map(workout => (
              <button
                key={workout.id}
                onClick={() => navigate(`/workout/${workout.id}`)}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-left"
              >
                <Dumbbell className="w-4 h-4 text-sky-500 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold truncate">{workout.name}</p>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-sky-500/70">
                    {workout.type}
                    {workout.duration ? ` • ${workout.duration}` : ''}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {empty && (
          <div className="py-8 text-center space-y-1">
            <CalendarDays className="w-7 h-7 text-muted-foreground/20 mx-auto" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
              Nothing planned for this day
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => addTaskOn(selectedDate)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-primary/10 text-primary text-[9px] font-black uppercase tracking-widest hover:bg-primary/20 transition-all"
          >
            <Plus className="w-3 h-3" /> Task
          </button>
          <button
            onClick={() => navigate(`/add-meal?date=${selectedDate.toISOString()}`)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-rose-500/10 text-rose-600  text-[9px] font-black uppercase tracking-widest hover:bg-rose-500/20 transition-all"
          >
            <Plus className="w-3 h-3" /> Meal
          </button>
          <button
            onClick={() => navigate(`/add-workout?date=${selectedDate.toISOString()}`)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-sky-500/10 text-sky-600  text-[9px] font-black uppercase tracking-widest hover:bg-sky-500/20 transition-all"
          >
            <Plus className="w-3 h-3" /> Workout
          </button>
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarDays className="w-5 h-5 text-primary flex-shrink-0" />
          <span className="text-sm font-semibold tracking-tight truncate">{headerLabel}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!isToday(selectedDate) && (
            <button
              onClick={() => onSelectDate(startOfToday())}
              className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest text-primary bg-primary/10 hover:bg-primary/20 transition-all"
            >
              Today
            </button>
          )}
          <button
            onClick={() => shift(-1)}
            aria-label={`Previous ${view}`}
            className="p-2 rounded-full bg-card border border-border hover:bg-muted transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => shift(1)}
            aria-label={`Next ${view}`}
            className="p-2 rounded-full bg-card border border-border hover:bg-muted transition-all"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex p-1.5 rounded-2xl bg-muted/50 border border-border">
        {(['day', 'week', 'month'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => setView(mode)}
            aria-pressed={view === mode}
            className={cn(
              'flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all',
              view === mode ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {mode}
          </button>
        ))}
      </div>

      <motion.div
        key={view}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {view === 'month' ? renderMonth() : view === 'week' ? renderWeek() : renderDay()}
      </motion.div>

      <div className="flex flex-wrap gap-3 px-1 pt-1">
        <span className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-widest text-muted-foreground/60">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" /> Tasks
        </span>
        <span className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-widest text-muted-foreground/60">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> Meals
        </span>
        <span className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-widest text-muted-foreground/60">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400" /> Workouts
        </span>
      </div>

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
    </section>
  );
};

export default CalendarView;
