import React, { useState, useEffect } from 'react';
import VoiceButton from '../components/VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ChevronLeft, 
  Utensils, 
  Droplets, 
  Plus, 
  Beef, 
  Croissant, 
  Egg, 
  Trash2, 
  Settings, 
  Eye, 
  EyeOff, 
  PlusCircle, 
  Info 
} from '../components/icons';
import { cn } from '../lib/utils';
import { useAuth } from '../components/AuthProvider';
import { storage } from '../lib/storage';
import { Meal } from '../types';
import { format } from 'date-fns';

const Nutrition: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [meals, setMeals] = useState<Meal[]>([]);
  const [water, setWater] = useState(0); // Liters
  const waterGoal = 2.0;

  // Calorie tracking settings
  const [calorieGoal, setCalorieGoal] = useState<number>(() => {
    const saved = localStorage.getItem('serene_calorie_goal');
    return saved ? Number(saved) : 2200;
  });
  const [calorieTrackingEnabled, setCalorieTrackingEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('serene_calorie_tracking_enabled');
    return saved !== 'false'; // Defaults to true
  });

  // UI state toggles
  const [showSettings, setShowSettings] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [customWaterMl, setCustomWaterMl] = useState('');

  // Manual Add Form states
  const [foodName, setFoodName] = useState('');
  const [mealType, setMealType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('breakfast');
  const [caloriesInput, setCaloriesInput] = useState('');
  const [proteinInput, setProteinInput] = useState('');
  const [carbsInput, setCarbsInput] = useState('');
  const [fatsInput, setFatsInput] = useState('');

  useEffect(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    
    const unsubHydration = storage.subscribe('serene_hydration', (data) => {
      const todayData = (data as any[]).find(h => h.date === today);
      setWater(todayData ? todayData.amount : 0);
    });

    const unsubMeals = storage.subscribe(storage.key.MEALS, (data) => {
      const dailyMeals = (data as Meal[]).filter(m => {
        try {
          return format(new Date(m.date), 'yyyy-MM-dd') === today;
        } catch {
          return false;
        }
      });
      setMeals(dailyMeals);
    });

    return () => {
      unsubHydration();
      unsubMeals();
    };
  }, []);

  const updateWater = async (newAmount: number) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const cappedAmount = Math.min(newAmount, 10); // Cap at 10L

    try {
      const data = await storage.getAll<any>('serene_hydration');
      const todayDoc = data.find(h => h.date === today);
      
      if (todayDoc) {
        await storage.update('serene_hydration', todayDoc.id, { 
          amount: cappedAmount,
          updatedAt: new Date().toISOString()
        });
      } else {
        await storage.add('serene_hydration', {
          uid: user?.uid || 'guest',
          date: today,
          amount: cappedAmount,
          createdAt: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error("Error updating water:", error);
    }
  };

  const saveCalorieGoal = (val: string) => {
    const num = Number(val);
    if (!isNaN(num) && num >= 0) {
      setCalorieGoal(num);
      localStorage.setItem('serene_calorie_goal', num.toString());
    }
  };

  const toggleCalorieTracking = () => {
    const newVal = !calorieTrackingEnabled;
    setCalorieTrackingEnabled(newVal);
    localStorage.setItem('serene_calorie_tracking_enabled', newVal.toString());
  };

  const handleAddMeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!foodName.trim()) return;

    try {
      await storage.add(storage.key.MEALS, {
        uid: user?.uid || 'guest',
        date: new Date().toISOString(),
        type: mealType,
        name: foodName.trim(),
        calories: Number(caloriesInput) || 0,
        protein: Number(proteinInput) || 0,
        carbs: Number(carbsInput) || 0,
        fats: Number(fatsInput) || 0,
      });

      // Reset form fields
      setFoodName('');
      setCaloriesInput('');
      setProteinInput('');
      setCarbsInput('');
      setFatsInput('');
      setShowManualAdd(false);
    } catch (err) {
      console.error("Failed to add meal:", err);
    }
  };

  const deleteMeal = async (id: string) => {
    try {
      await storage.delete(storage.key.MEALS, id);
    } catch (err) {
      console.error("Failed to delete meal:", err);
    }
  };

  const totalCalories = meals.reduce((acc, meal) => acc + (meal.calories || 0), 0);
  const totalProtein = meals.reduce((acc, meal) => acc + (meal.protein || 0), 0);
  const totalCarbs = meals.reduce((acc, meal) => acc + (meal.carbs || 0), 0);
  const totalFats = meals.reduce((acc, meal) => acc + (meal.fats || 0), 0);

  const remainingCalories = Math.max(0, calorieGoal - totalCalories);
  const progress = calorieGoal > 0 ? Math.min(100, (totalCalories / calorieGoal) * 100) : 0;

  return (
    <div className="min-h-screen bg-background pb-32">
      <header className="sticky top-0 z-30 bg-background/80 p-6 flex items-center justify-between border-b border-border/10">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate(-1)}
            className="p-2 text-accent hover:bg-accent/10 rounded-full transition-all"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold text-accent tracking-tight">Nutrition</h1>
        </div>

        <button 
          onClick={() => setShowSettings(!showSettings)}
          className={cn(
            "p-2.5 rounded-full border transition-all",
            showSettings 
              ? "bg-accent/10 border-accent/30 text-accent" 
              : "bg-card border-border hover:bg-muted text-muted-foreground"
          )}
          title="Calorie Tracker Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </header>

      <main className="p-6 space-y-6">
        
        {/* Calorie Settings Drawer/Panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="p-6 rounded-3xl bg-card border-2 border-accent/20 space-y-4 mb-4 shadow-inner">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <h3 className="font-bold text-sm text-foreground">Calorie Tracking</h3>
                    <p className="text-[10px] text-muted-foreground">Toggle calorie goals and display metrics</p>
                  </div>
                  <button
                    onClick={toggleCalorieTracking}
                    className={cn(
                      "px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-xl transition-all border",
                      calorieTrackingEnabled 
                        ? "bg-accent text-primary-foreground border-accent" 
                        : "bg-muted text-muted-foreground border-border"
                    )}
                  >
                    {calorieTrackingEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                {calorieTrackingEnabled && (
                  <div className="space-y-3 pt-2 border-t border-border/40">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Daily Calorie Target (cal)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        max="10000"
                        value={calorieGoal}
                        onChange={(e) => saveCalorieGoal(e.target.value)}
                        className="flex-1 p-3 rounded-2xl bg-background border border-border text-xs focus:ring-1 focus:ring-accent focus:outline-none font-bold"
                      />
                      <div className="flex gap-1">
                        {[1800, 2000, 2200, 2500].map((preset) => (
                          <button
                            key={preset}
                            onClick={() => saveCalorieGoal(preset.toString())}
                            className={cn(
                              "px-2.5 text-[10px] font-bold rounded-xl border transition-all",
                              calorieGoal === preset 
                                ? "bg-accent/10 border-accent/20 text-accent" 
                                : "bg-background border-border hover:bg-muted text-muted-foreground"
                            )}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Calorie Display (If Enabled) */}
        {calorieTrackingEnabled ? (
          <div className="text-center space-y-2 py-4">
            <div className="p-6 rounded-full bg-accent/10 text-accent w-fit mx-auto border border-accent/10 shadow-sm animate-pulse">
              <Utensils className="w-12 h-12" />
            </div>
            <h2 className="text-4xl font-black text-foreground">{totalCalories}</h2>
            <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Calories Consumed Today</p>
          </div>
        ) : (
          <div className="p-6 rounded-3xl bg-orange-500/5 border border-orange-500/15 flex items-start gap-4">
            <Info className="w-5 h-5 text-accent shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-foreground">Calorie Goals Inactive</h4>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                You currently have calorie goals and progress bars turned off. You can easily re-enable calorie goal targets by tapping the gear icon above.
              </p>
            </div>
          </div>
        )}

        {/* Progress & Macro/Calories Card */}
        <div className="p-8 rounded-sm bg-card border border-border shadow-sm space-y-6">
          {calorieTrackingEnabled && (
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <div className="space-y-1">
                  <h3 className="font-bold text-foreground">Daily Goal Progress</h3>
                  <p className="text-xs text-muted-foreground">
                    {remainingCalories > 0 ? `${remainingCalories} cal left` : 'Goal met! Enjoy your day'}
                  </p>
                </div>
                <span className="text-3xl font-black text-accent">{Math.round(progress)}%</span>
              </div>
              
              <div className="h-4 bg-muted rounded-full overflow-hidden border border-border/30">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  className="h-full bg-accent"
                />
              </div>
            </div>
          )}

          {/* Core Nutrient Grid (Protein, Carbs, Fats, and Calories) */}
          <div className="space-y-4">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 block">Macro Dashboard</span>
            <div className="grid grid-cols-4 gap-2.5 pt-1">
              {/* Protein: steak icon */}
              <div className="text-center p-3 rounded-2xl bg-secondary/10 border border-secondary/10 space-y-1.5">
                <Beef className="w-5 h-5 text-accent/80 mx-auto" />
                <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider">Protein</p>
                <p className="text-xs font-black text-foreground">{totalProtein}g</p>
              </div>

              {/* Carbs: loaf of bread icon */}
              <div className="text-center p-3 rounded-2xl bg-secondary/10 border border-secondary/10 space-y-1.5">
                <Croissant className="w-5 h-5 text-accent/80 mx-auto" />
                <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider">Carbs</p>
                <p className="text-xs font-black text-foreground">{totalCarbs}g</p>
              </div>

              {/* Fats: cheese icon */}
              <div className="text-center p-3 rounded-2xl bg-secondary/10 border border-secondary/10 space-y-1.5">
                <Egg className="w-5 h-5 text-accent/80 mx-auto" />
                <p className="text-[9px] font-black text-muted-foreground uppercase tracking-wider">Fats</p>
                <p className="text-xs font-black text-foreground">{totalFats}g</p>
              </div>

              {/* Calories added to the macros section */}
              <div className="text-center p-3 rounded-2xl bg-accent/5 border border-accent/5 flex flex-col justify-between items-center h-full">
                <Utensils className="w-5 h-5 text-accent mx-auto" />
                <p className="text-[9px] font-black text-muted-foreground uppercase tracking-tight text-center w-full block">Calories</p>
                <p className="text-xs font-black text-black  text-center w-full">{totalCalories} cal</p>
              </div>
            </div>
          </div>
        </div>

        {/* Manually Add What I Have Eaten Panel */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-foreground uppercase tracking-wider">Food Log</h3>
            <button
              onClick={() => setShowManualAdd(!showManualAdd)}
              className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-accent border border-accent/20 bg-accent/5 px-4 py-2 rounded-2xl hover:bg-accent/10 transition-all"
            >
              <Plus className="w-4 h-4" />
              Log Food
            </button>
          </div>

          <AnimatePresence>
            {showManualAdd && (
              <motion.form
                onSubmit={handleAddMeal}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden p-6 rounded-3xl bg-card border-2 border-border/80 space-y-4 shadow-sm"
              >
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">What did you eat?</label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      placeholder="e.g. Avocado Toast with Eggs"
                      value={foodName}
                      onChange={(e) => setFoodName(e.target.value)}
                      className="w-full p-3.5 pr-12 rounded-2xl bg-background border border-border text-xs focus:ring-1 focus:ring-accent focus:outline-none"
                    />
                    <VoiceButton
                      size="sm"
                      className="absolute right-0.5 top-1/2 -translate-y-1/2"
                      onTranscript={(text) => setFoodName(prev => appendDictation(prev, text))}
                      label="Dictate what you ate"
                    />
                  </div>
                </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Meal Type</label>
                      <select
                        value={mealType}
                        onChange={(e: any) => setMealType(e.target.value)}
                        className="w-full p-3.5 rounded-2xl bg-background border border-border text-xs focus:ring-1 focus:ring-accent focus:outline-none font-bold text-foreground"
                      >
                        <option value="breakfast">Breakfast</option>
                        <option value="lunch">Lunch</option>
                        <option value="dinner">Dinner</option>
                        <option value="snack">Snack</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Calories (cal)</label>
                      <input
                        type="number"
                        placeholder="Calories"
                        value={caloriesInput}
                        onChange={(e) => setCaloriesInput(e.target.value)}
                        className="w-full p-3.5 rounded-2xl bg-background border border-border text-xs focus:ring-1 focus:ring-accent focus:outline-none"
                      />
                    </div>
                  </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground block text-center">Protein (g)</label>
                    <input
                      type="number"
                      placeholder="g"
                      value={proteinInput}
                      onChange={(e) => setProteinInput(e.target.value)}
                      className="w-full p-3 rounded-2xl bg-background border border-border text-xs focus:ring-1 focus:ring-accent focus:outline-none text-center"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground block text-center">Carbs (g)</label>
                    <input
                      type="number"
                      placeholder="g"
                      value={carbsInput}
                      onChange={(e) => setCarbsInput(e.target.value)}
                      className="w-full p-3 rounded-2xl bg-background border border-border text-xs focus:ring-1 focus:ring-accent focus:outline-none text-center"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground block text-center">Fats (g)</label>
                    <input
                      type="number"
                      placeholder="g"
                      value={fatsInput}
                      onChange={(e) => setFatsInput(e.target.value)}
                      className="w-full p-3 rounded-2xl bg-background border border-border text-xs focus:ring-1 focus:ring-accent focus:outline-none text-center"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 py-3.5 rounded-2xl bg-accent text-primary-foreground font-black text-xs uppercase tracking-widest shadow-md hover:bg-accent/90 transition-all"
                  >
                    Add to Log
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowManualAdd(false)}
                    className="px-5 py-3.5 rounded-2xl border border-border hover:bg-muted font-bold text-xs uppercase text-muted-foreground transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>

          {/* Today's Logged Items List */}
          <div className="space-y-2">
            {meals.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded-3xl bg-card/40">No foods logged today yet.</p>
            ) : (
              <div className="space-y-2">
                {meals.map((meal) => (
                  <div 
                    key={meal.id}
                    className="p-4 rounded-2xl bg-card border border-border/60 flex items-center justify-between group shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded bg-muted text-muted-foreground">
                          {meal.type}
                        </span>
                        <h4 className="text-xs font-bold text-foreground truncate">{meal.name}</h4>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-semibold">
                        {meal.calories !== undefined && <span>{meal.calories} cal</span>}
                        {meal.protein !== undefined && (
                          <span className="flex items-center gap-1">
                            <Beef className="w-3 h-3 text-accent/50" /> P: {meal.protein}g
                          </span>
                        )}
                        {meal.carbs !== undefined && (
                          <span className="flex items-center gap-1">
                            <Croissant className="w-3 h-3 text-accent/50" /> C: {meal.carbs}g
                          </span>
                        )}
                        {meal.fats !== undefined && (
                          <span className="flex items-center gap-1">
                            <Egg className="w-3 h-3 text-accent/50" /> F: {meal.fats}g
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteMeal(meal.id)}
                      className="p-2 border border-transparent rounded-xl hover:border-border text-muted-foreground hover:text-red-500 transition-all opacity-0 group-hover:opacity-100 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Hydration Card */}
        <div className="p-8 rounded-sm bg-secondary/10 border border-secondary/20 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-[#E0F2F1] text-teal-600 shrink-0">
                <Droplets className="w-6 h-6 text-teal-500 animate-pulse" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="font-extrabold text-foreground tracking-tight text-base">Hydration</h3>
                <p className="text-xs text-muted-foreground font-semibold">
                  <span className="text-blue-600  font-bold">{water.toFixed(2)}L</span> / {waterGoal.toFixed(1)}L Goal
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-1 bg-card/60 rounded-xl p-1 border border-border/30">
              <button
                onClick={() => updateWater(Math.max(0, water - 0.25))}
                className="text-[10px] uppercase font-black px-2 py-1 text-muted-foreground hover:bg-muted rounded-lg transition-all"
                title="Remove 250ml"
              >
                Undo 250ml
              </button>
            </div>
          </div>
          
          <div className="h-4 bg-blue-100 rounded-full overflow-hidden border border-blue-200">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${(water / waterGoal) * 100}%` }}
              className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
            />
          </div>

          <div className="space-y-4 pt-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 block">Quick Log Presets</span>
            
            {/* Quick add presets */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'Glass (250ml)', value: 0.25 },
                { label: 'Bottle (500ml)', value: 0.5 },
                { label: 'Flask (750ml)', value: 0.75 },
                { label: 'Large (1L)', value: 1.0 }
              ].map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => updateWater(water + preset.value)}
                  className="py-2.5 px-3 text-[11px] font-semibold rounded-2xl bg-card border border-border hover:bg-blue-500/5 hover:border-blue-500/40 text-foreground transition-all text-center font-bold flex flex-col justify-center items-center gap-0.5"
                >
                  <span className="text-blue-500 font-extrabold">+ {preset.value}L</span>
                  <span className="text-[9px] text-muted-foreground font-semibold">{preset.label}</span>
                </button>
              ))}
            </div>

            {/* Custom ML Add */}
            <div className="bg-card p-4 rounded-3xl border border-border/60 space-y-3">
              <label className="block text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">
                Add Custom Amount
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    min="1"
                    max="5000"
                    placeholder="e.g. 350 for 350ml cup"
                    value={customWaterMl}
                    onChange={(e) => setCustomWaterMl(e.target.value)}
                    className="w-full p-3 pr-10 rounded-2xl bg-background border border-border text-xs focus:ring-1 focus:ring-accent focus:outline-none font-bold"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-muted-foreground uppercase">
                    ML
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const ml = parseInt(customWaterMl, 10);
                    if (!isNaN(ml) && ml > 0) {
                      updateWater(water + (ml / 1000));
                      setCustomWaterMl('');
                    }
                  }}
                  className="px-5 py-3 rounded-2xl bg-blue-500 text-primary-foreground font-black text-xs uppercase tracking-widest transition-all border border-blue-500 shrink-0"
                >
                  + Add
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Apple Health Placeholder */}
        <div className="p-6 rounded-sm bg-accent/5 border border-accent/10 flex items-start gap-4">
          <Info className="w-5 h-5 text-accent mt-1 shrink-0" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-foreground">Apple Health Integration</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Sync your nutrition data from Apple Health to automatically track your micronutrients and hydration levels.
            </p>
          </div>
        </div>

        <button 
          onClick={() => {
            navigate('/plan?tab=meals');
          }}
          className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all"
        >
          Go to Meal Plan
        </button>
      </main>
    </div>
  );
};

export default Nutrition;
