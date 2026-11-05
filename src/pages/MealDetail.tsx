import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronLeft, Clock, Flame, Info, Utensils, Heart, ShoppingBag, Plus } from '../components/icons';
import { storage } from '../lib/storage';
import { Meal } from '../types';
import { useAuth } from '../components/AuthProvider';
import { cn } from '../lib/utils';

const MealDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [meal, setMeal] = useState<Meal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMeal = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const item = await storage.getById<Meal>(storage.key.MEALS, id);
        if (item) {
          setMeal(item);
        }
      } catch (error) {
        console.error('Error fetching meal:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMeal();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!meal) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Meal not found</p>
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
        <h1 className="text-xl font-bold tracking-tight text-primary">Meal Details</h1>
        <div className="w-10" /> {/* Spacer */}
      </header>

      {/* Hero Section */}
      <section className="relative rounded-sm overflow-hidden aspect-video shadow-lg">
        <img 
          src={meal.photo || `https://picsum.photos/seed/${meal.name}/800/450`} 
          alt={meal.name}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-black/55 flex flex-col justify-end p-8">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary-foreground/80 mb-2">{meal.type}</span>
          <h2 className="text-3xl font-black text-primary-foreground tracking-tighter">{meal.name}</h2>
        </div>
      </section>

      {/* Stats Bar */}
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
        <div className="flex-1 min-w-[120px] p-4 rounded-2xl bg-rose/10 border border-rose/20 flex flex-col items-center gap-1">
          <Flame className="w-4 h-4 text-rose" />
          <span className="text-lg font-bold">{meal.calories || 0}</span>
          <span className="text-[8px] font-bold uppercase tracking-widest text-rose-foreground/60">Calories</span>
        </div>
        <div className="flex-1 min-w-[120px] p-4 rounded-2xl bg-sky/10 border border-sky/20 flex flex-col items-center gap-1">
          <Heart className="w-4 h-4 text-sky" />
          <span className="text-lg font-bold">{meal.protein || 0}g</span>
          <span className="text-[8px] font-bold uppercase tracking-widest text-sky-foreground/60">Protein</span>
        </div>
        <div className="flex-1 min-w-[120px] p-4 rounded-2xl bg-lavender/10 border border-lavender/20 flex flex-col items-center gap-1">
          <Clock className="w-4 h-4 text-lavender" />
          <span className="text-lg font-bold">{meal.prepTime || '10m'}</span>
          <span className="text-[8px] font-bold uppercase tracking-widest text-lavender-foreground/60">Prep Time</span>
        </div>
      </div>

      {/* Recipe Info */}
      <div className="grid gap-8">
        {meal.ingredients && meal.ingredients.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-bold">Ingredients</h3>
              </div>
              <button 
                className="text-[10px] font-bold text-primary uppercase tracking-widest flex items-center gap-1"
                onClick={() => navigate('/shopping-list')}
              >
                <Plus className="w-3 h-3" />
                Add to List
              </button>
            </div>
            <div className="bg-card rounded-sm p-6 border border-border shadow-sm space-y-3">
              {meal.ingredients.map((ing, i) => (
                <div key={i} className="flex items-center gap-3 text-sm font-medium border-b border-border/50 pb-2 last:border-0 last:pb-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
                  {ing}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Utensils className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold">Instructions</h3>
          </div>
          <div className="bg-card rounded-sm p-6 border border-border shadow-sm">
            <p className="text-sm font-medium leading-relaxed text-muted-foreground">
              {meal.instructions || meal.recipe || 'No instructions provided.'}
            </p>
          </div>
        </section>

        {meal.link && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Info className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-bold">External Source</h3>
            </div>
            <a 
              href={meal.link} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center justify-between p-6 rounded-2xl bg-muted/50 border border-border hover:bg-muted transition-all group"
            >
              <span className="text-sm font-medium truncate flex-1 mr-4">{meal.link}</span>
              <Plus className="w-4 h-4 text-primary rotate-45 group- transition-transform" />
            </a>
          </section>
        )}
      </div>

      <button
        onClick={() => navigate('/assign-meal')}
        className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" />
        Add to another day
      </button>
    </div>
  );
};

export default MealDetail;
