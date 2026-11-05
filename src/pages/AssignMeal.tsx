import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronLeft, Calendar, Clock, Check, Lightbulb } from '../components/icons';
import { cn } from '../lib/utils';
import { storage } from '../lib/storage';
import { format, addMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth } from 'date-fns';

const AssignMeal: React.FC = () => {
  const navigate = useNavigate();
  const [pendingMeal] = useState(() => {
    try {
      const str = sessionStorage.getItem('pendingMeal');
      return str ? JSON.parse(str) : null;
    } catch {
      return null;
    }
  });

  // Initialize selectedDate from pendingMeal if it exists and has a date
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    if (pendingMeal?.date) {
      const d = new Date(pendingMeal.date);
      return isNaN(d.getTime()) ? new Date() : d;
    }
    return new Date();
  });
  const [selectedType, setSelectedType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>(pendingMeal?.type || 'breakfast');
  const [isSaving, setIsSaving] = useState(false);

  React.useEffect(() => {
    if (!pendingMeal) {
      navigate('/add-meal');
    }
  }, [pendingMeal, navigate]);

  if (!pendingMeal) return null;

  const months = Array.from({ length: 12 }, (_, i) => startOfMonth(addMonths(new Date(), i)));
  const [currentMonthIndex, setCurrentMonthIndex] = useState(0);
  const currentMonth = months[currentMonthIndex];
  
  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  // Month Selection Header
  const handleMonthChange = (idx: number) => {
    setCurrentMonthIndex(idx);
    const newMonth = months[idx];
    // If current selected date is not in the new month, default to 1st of that month
    if (!isSameMonth(selectedDate, newMonth)) {
      setSelectedDate(startOfMonth(newMonth));
    }
  };

  const handleConfirm = async () => {
    setIsSaving(true);
    
    try {
      const mealData = {
        ...pendingMeal,
        date: selectedDate.toISOString(),
        type: selectedType,
      };
      
      const { saveToRecipes, ...cleanMealData } = mealData;

      // Save to Meal Plan
      await storage.add(storage.key.MEALS, cleanMealData);

      // Save to Recipes if requested
      if (saveToRecipes) {
        await storage.add(storage.key.RECIPES, {
          ...cleanMealData,
          date: new Date().toISOString(), // Recipe creation date
        });
      }

      // Google Calendar Sync disabled

      sessionStorage.removeItem('pendingMeal');
      
      // Use state to specify the active tab when redirecting to plan
      navigate('/plan', { state: { activeTab: 'meals' } });
    } catch (error) {
      console.error('Error assigning meal:', error);
      alert('There was an error saving your meal. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-card pb-24">
      <header className="sticky top-0 z-30 bg-card/80 p-6 flex items-center gap-4">
        <button 
          onClick={() => navigate(-1)}
          className="p-2 text-[#8B5E3C] hover:bg-[#8B5E3C]/10 rounded-full transition-all"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold text-[#8B5E3C] tracking-tight">Assign Meal</h1>
      </header>

      <main className="p-6 space-y-8">
        {/* Meal Preview */}
        <div className="p-4 rounded-3xl bg-card border border-border shadow-sm flex items-center gap-4">
          {pendingMeal.photo ? (
            <img src={pendingMeal.photo} alt={pendingMeal.name} className="w-12 h-12 rounded-full object-cover" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <Check className="w-6 h-6" />
            </div>
          )}
          <div>
            <h3 className="font-bold text-[#4A3728]">{pendingMeal.name}</h3>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
              {pendingMeal.saveToRecipes ? "Saving to Recipes & Plan" : "Saving to Plan"}
            </p>
          </div>
        </div>

        {/* Month Selection */}
        <div className="space-y-3">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Select Month</label>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {months.map((month, idx) => (
              <button
                key={idx}
                onClick={() => handleMonthChange(idx)}
                className={cn(
                  "flex-shrink-0 px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all",
                  currentMonthIndex === idx 
                    ? "bg-primary text-primary-foreground shadow-md" 
                    : "bg-card text-muted-foreground border border-border"
                )}
              >
                {format(month, 'MMMM')}
              </button>
            ))}
          </div>
        </div>

        {/* Day Selection */}
        <div className="space-y-3">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Select Day</label>
          <div className="grid grid-cols-7 gap-2">
            {days.map((day) => (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDate(day)}
                className={cn(
                  "aspect-square rounded-xl flex flex-col items-center justify-center transition-all",
                  isSameDay(selectedDate, day)
                    ? "bg-primary text-primary-foreground shadow-md scale-105"
                    : "bg-card text-muted-foreground border border-border hover:border-primary/50"
                )}
              >
                <span className="text-[8px] font-bold uppercase opacity-50">{format(day, 'EEE')}</span>
                <span className="text-sm font-bold">{format(day, 'd')}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Meal Type Selection */}
        <div className="space-y-3">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Select Meal</label>
          <div className="grid grid-cols-2 gap-3">
            {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={cn(
                  "py-4 rounded-2xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all",
                  selectedType === type
                    ? "bg-secondary text-secondary-foreground shadow-md"
                    : "bg-card text-muted-foreground border border-border"
                )}
              >
                {selectedType === type && <Check className="w-4 h-4" />}
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Google Calendar Sync Card Disabled */}

        <button
          onClick={handleConfirm}
          disabled={isSaving}
          className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isSaving ? "Saving..." : "Confirm & Save"}
        </button>
      </main>
    </div>
  );
};

export default AssignMeal;
