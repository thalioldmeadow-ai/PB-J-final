import React, { useState, useEffect } from 'react';
import VoiceButton from '../components/VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';
import { motion } from 'motion/react';
import { 
  Utensils, 
  Dumbbell, 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  ExternalLink, 
  Trash2, 
  Lightbulb, 
  Clock, 
  ShoppingBag,
  RefreshCw,
  LogIn,
  Link2,
  BookOpen,
  CalendarDays,
  Wallet
} from '../components/icons';
import { cn } from '../lib/utils';
import { format, isSameDay, isToday, startOfToday } from 'date-fns';
import CalendarView from '../components/CalendarView';
import BudgetingView from '../components/BudgetingView';
import AiAssist from '../components/AiAssist';
import { loadPlanFacts } from '../lib/aiFacts';
import { useAuth } from '../components/AuthProvider';
import { storage } from '../lib/storage';
import { Meal, Workout } from '../types';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';

const Plan: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  
  type PlanTab = 'meals' | 'workouts' | 'calendar' | 'budgeting';

  // Tab priority: state > query param > default
  const requestedTab = (location.state as any)?.activeTab || searchParams.get('tab');
  const initialTab: PlanTab = ['workouts', 'calendar', 'budgeting'].includes(requestedTab)
    ? (requestedTab as PlanTab)
    : 'meals';
  const [activeTab, setActiveTab] = useState<PlanTab>(initialTab);
  const [activeMealType, setActiveMealType] = useState<'all' | 'breakfast' | 'lunch' | 'dinner' | 'snack'>('all');
  const [activeWorkoutType, setActiveWorkoutType] = useState<'all' | 'strength' | 'cardio' | 'yoga' | 'other'>('all');
  const [selectedDate, setSelectedDate] = useState(startOfToday());
  const [meals, setMeals] = useState<Meal[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);

  // Google Calendar States
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [fetchingEvents, setFetchingEvents] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  // General add modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<string>('');

  // Google calendar custom event modal
  const [showGoogleEventModal, setShowGoogleEventModal] = useState(false);
  const [gEventTitle, setGEventTitle] = useState('');
  const [gEventDesc, setGEventDesc] = useState('');
  const [gEventStartHour, setGEventStartHour] = useState('09:00');
  const [gEventEndHour, setGEventEndHour] = useState('10:00');
  const [addingGEvent, setAddingGEvent] = useState(false);

  // Switching between Meals, Workouts, Calendar and Budget should reveal the
  // top of the newly selected view rather than keeping the previous scroll.
  useEffect(() => {
    window.scrollTo(0, 0);
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
  }, [activeTab]);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'meals' || tabParam === 'workouts' || tabParam === 'calendar' || tabParam === 'budgeting') {
      setActiveTab(tabParam);
    } else if ((location.state as any)?.activeTab) {
      const stateTab = (location.state as any).activeTab;
      if (stateTab === 'meals' || stateTab === 'workouts' || stateTab === 'calendar' || stateTab === 'budgeting') {
        setActiveTab(stateTab);
      }
    }
  }, [searchParams, location.state]);

  useEffect(() => {
    const unsubMeals = storage.subscribe(storage.key.MEALS, (data) => setMeals(data as Meal[]));
    const unsubWorkouts = storage.subscribe(storage.key.WORKOUTS, (data) => setWorkouts(data as Workout[]));
    return () => {
      unsubMeals();
      unsubWorkouts();
    };
  }, []);

  const filteredMeals = meals.filter(m => {
    const dateMatch = isSameDay(new Date(m.date), selectedDate);
    const typeMatch = activeMealType === 'all' || m.type === activeMealType;
    return dateMatch && typeMatch;
  });

  const filteredWorkouts = workouts.filter(w => {
    const dateMatch = isSameDay(new Date(w.date), selectedDate);
    const typeMatch = activeWorkoutType === 'all' || w.type === activeWorkoutType;
    return dateMatch && typeMatch;
  });

  const addItem = async () => {
    if (!newItemName.trim()) return;
    const key = activeTab === 'workouts' ? storage.key.WORKOUTS : storage.key.MEALS;
    
    const type = newItemType || (activeTab === 'workouts' ? (activeWorkoutType === 'all' ? 'strength' : activeWorkoutType) : (activeMealType === 'all' ? 'breakfast' : activeMealType));

    const newItem = {
      uid: user?.uid || 'guest',
      name: newItemName.trim(),
      date: selectedDate.toISOString(),
      type: type,
      ...(activeTab === 'workouts' ? { duration: '30 min' } : {})
    };

    try {
      await storage.add(key, newItem);
      setNewItemName('');
      setNewItemType('');
      setShowAddModal(false);
    } catch (error) {
      console.error('Error adding item:', error);
    }
  };

  const deleteItem = async (id: string) => {
    const key = activeTab === 'workouts' ? storage.key.WORKOUTS : storage.key.MEALS;
    try {
      await storage.delete(key, id);
    } catch (error) {
      console.error('Error deleting item:', error);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      
      {/* Tab Switcher */}
      <div className="flex p-1.5 rounded-2xl bg-muted/50 border border-border">
        {([
          { id: 'meals', label: 'Meals', Icon: Utensils },
          { id: 'workouts', label: 'Workouts', Icon: Dumbbell },
          { id: 'calendar', label: 'Calendar', Icon: CalendarDays },
          { id: 'budgeting', label: 'Budget', Icon: Wallet },
        ] as const).map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 py-3 rounded-xl text-[9px] font-bold uppercase tracking-wider transition-all duration-300 whitespace-nowrap",
              activeTab === id
                ? id === 'workouts'
                  ? "bg-secondary text-secondary-foreground shadow-sm"
                  : "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Big overall calendar over tasks, meals and workouts, its own tab */}
      {activeTab === 'calendar' && (
        <section className="space-y-4">
          <CalendarView selectedDate={selectedDate} onSelectDate={setSelectedDate} />
        </section>
      )}

      {activeTab === 'budgeting' && <BudgetingView />}

      {/* Primary Panels rendering based on active tab */}
      {(activeTab === 'meals' || activeTab === 'workouts') && (
      <section className="space-y-6">
        
        {/* Tab-headers with specialized Actions */}
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold tracking-tight text-primary">
            {activeTab === 'meals' ? "Planned Meals" : "Planned Workouts"}
          </h2>
          <div className="flex items-center gap-2">
            {activeTab === 'meals' && (
              <>
                <button 
                  onClick={() => navigate('/recipes')}
                  className="p-2 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-all flex items-center justify-center"
                  title="Recipe Book"
                >
                  <BookOpen className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => navigate('/shopping-list')}
                  className="p-2 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-all flex items-center justify-center"
                  title="Shopping List"
                >
                  <ShoppingBag className="w-5 h-5" />
                </button>
              </>
            )}
            
            <button 
              onClick={() => {
                if (activeTab === 'meals') {
                  const type = activeMealType === 'all' ? 'breakfast' : activeMealType;
                  navigate(`/add-meal?type=${type}&date=${selectedDate.toISOString()}`);
                } else {
                  const type = activeWorkoutType === 'all' ? 'strength' : activeWorkoutType;
                  navigate(`/add-workout?type=${type}&date=${selectedDate.toISOString()}`);
                }
              }}
              className="text-primary p-2 rounded-full hover:bg-primary/10 transition-all"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Dynamic subcategory filtering buttons */}
        {activeTab === 'meals' && (
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {(['all', 'breakfast', 'lunch', 'dinner', 'snack'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setActiveMealType(type)}
                className={cn(
                  "px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap border",
                  activeMealType === type 
                    ? "bg-primary text-primary-foreground border-primary shadow-sm" 
                    : "bg-card text-muted-foreground border-border hover:border-primary/50"
                )}
              >
                {type}
              </button>
            ))}
          </div>
        )}

        {activeTab === 'workouts' && (
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {(['all', 'strength', 'cardio', 'yoga', 'other'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setActiveWorkoutType(type)}
                className={cn(
                  "px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap border",
                  activeWorkoutType === type 
                    ? "bg-primary text-primary-foreground border-primary shadow-sm" 
                    : "bg-card text-muted-foreground border-border hover:border-primary/50"
                )}
              >
                {type}
              </button>
            ))}
          </div>
        )}

        {/* Main List Rendering */}
        <div className="space-y-4">
          
          {/* MEALS RENDERER */}
          {activeTab === 'meals' && (
            filteredMeals.length > 0 ? (
              filteredMeals.map((meal) => (
                <motion.div
                  key={meal.id}
                  whileHover={{ y: -2 }}
                  className={cn(
                    "group p-5 rounded-3xl border shadow-sm hover:shadow-md transition-all duration-300",
                    meal.type === 'breakfast' ? "bg-rose/20 border-rose/30" : 
                    meal.type === 'lunch' ? "bg-sky/20 border-sky/30" : 
                    meal.type === 'dinner' ? "bg-moss/20 border-moss/30" : "bg-lavender/20 border-lavender/30"
                  )}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="space-y-1">
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-widest",
                        meal.type === 'breakfast' ? "text-rose-foreground" : 
                        meal.type === 'lunch' ? "text-sky-foreground" : 
                        meal.type === 'dinner' ? "text-moss-foreground" : "text-lavender-foreground"
                      )}>{meal.type}</span>
                      <h3 className="text-lg font-semibold tracking-tight">{meal.name}</h3>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => navigate(`/meal/${meal.id}`)}
                        className="p-2 rounded-full hover:bg-primary/20 transition-all text-primary"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteItem(meal.id)} className="p-2 rounded-full hover:bg-primary/20 transition-all text-primary">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {meal.recipe && <p className="text-sm text-muted-foreground font-medium leading-relaxed">{meal.recipe}</p>}
                </motion.div>
              ))
            ) : (
              <div className="text-center py-12 bg-muted/30 rounded-sm border border-dashed border-border">
                <Utensils className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-20" />
                <p className="text-sm text-muted-foreground">
                  No meals planned for {isToday(selectedDate) ? 'today' : format(selectedDate, 'EEEE')}
                </p>
              </div>
            )
          )}

          {/* WORKOUTS RENDERER */}
          {activeTab === 'workouts' && (
            filteredWorkouts.length > 0 ? (
              filteredWorkouts.map((workout) => (
                <motion.div
                  key={workout.id}
                  whileHover={{ y: -2 }}
                  className={cn(
                    "group p-5 rounded-3xl border shadow-sm hover:shadow-md transition-all duration-300",
                    workout.type === 'strength' ? "bg-sky/20 border-sky/30" : 
                    workout.type === 'cardio' ? "bg-rose/20 border-rose/30" : 
                    workout.type === 'yoga' ? "bg-moss/20 border-moss/30" : "bg-lavender/20 border-lavender/30"
                  )}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">{workout.duration}</span>
                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">• {workout.type}</span>
                      </div>
                      <h3 className="text-lg font-semibold tracking-tight">{workout.name}</h3>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => navigate(`/workout/${workout.id}`)}
                        className="p-2 rounded-full hover:bg-black/5 transition-all"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteItem(workout.id)} className="p-2 rounded-full hover:bg-black/5 transition-all">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <button className={cn(
                    "w-full py-3 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all",
                    workout.type === 'strength' ? "bg-sky text-sky-foreground" : 
                    workout.type === 'cardio' ? "bg-rose text-rose-foreground" : 
                    workout.type === 'yoga' ? "bg-moss text-moss-foreground" : "bg-lavender text-lavender-foreground"
                  )}>
                    Start Workout
                  </button>
                </motion.div>
              ))
            ) : (
              <div className="text-center py-12 bg-muted/30 rounded-sm border border-dashed border-border">
                <Dumbbell className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-20" />
                <p className="text-sm text-muted-foreground">Rest day! No workouts planned</p>
              </div>
            )
          )}

          {/* GOOGLE CALENDAR RENDERER DISABLED */}

        </div>
      </section>
      )}

      {/* Contextual planning assistant, scoped to this tab */}
      {(activeTab === 'meals' || activeTab === 'workouts') && (
      <section className="pt-4">
        <AiAssist
          title="Plan the week"
          description="Uses your real tasks, overdue items and what is already planned. Figures are counted by the app, not the model."
          mode="planning"
          allowActions={['createTask', 'createGoal', 'updateTask']}
          suggestions={[
            { label: 'Plan my week', prompt: 'Help me plan the rest of this week using what is already on my plate.' },
            { label: 'What is overdue?', prompt: 'What is overdue and what should I do about it first?' },
            { label: 'Break down a goal', prompt: 'Help me turn one of my goals into smaller steps with a realistic timeline.' },
          ]}
          context={async () => ({ plan: await loadPlanFacts() })}
        />
      </section>
      )}

      {/* ADD GOOGLE CALENDAR EVENT MODAL DISABLED */}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-background/80 ">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-sm bg-card p-6 rounded-sm border border-border shadow-2xl space-y-4"
          >
            <h3 className="text-xl font-bold text-center">Add {activeTab === 'meals' ? 'Meal' : 'Workout'}</h3>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Name</label>
                <div className="relative">
                  <input
                    autoFocus
                    type="text"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder={activeTab === 'meals' ? "e.g., Quinoa Salad" : "e.g., Full Body HIIT"}
                    className="w-full p-4 pr-12 rounded-2xl bg-muted border-none focus:ring-2 focus:ring-primary text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && addItem()}
                  />
                  <VoiceButton
                    size="sm"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2"
                    onTranscript={(text) => setNewItemName(prev => appendDictation(prev, text))}
                    label="Dictate a name"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {activeTab === 'meals' ? (
                    (['breakfast', 'lunch', 'dinner', 'snack'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setNewItemType(type)}
                        className={cn(
                          "py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all",
                          newItemType === type ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-transparent"
                        )}
                      >
                        {type}
                      </button>
                    ))
                  ) : (
                    (['strength', 'cardio', 'yoga', 'other'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setNewItemType(type)}
                        className={cn(
                          "py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all",
                          newItemType === type ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-transparent"
                        )}
                      >
                        {type}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowAddModal(false)} className="flex-1 py-3 rounded-xl bg-muted text-xs font-bold uppercase tracking-widest">Cancel</button>
              <button onClick={addItem} className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest">Add</button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default Plan;
