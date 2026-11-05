import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronLeft, Droplets, Lightbulb, Activity, Moon, Utensils, Dumbbell, Brain, Heart, Target, Users } from '../components/icons';
import { cn } from '../lib/utils';

const PHASE_DATA: Record<string, any> = {
  'menstrual': {
    name: 'Menstrual Phase',
    icon: Droplets,
    color: 'text-[#95714F]', // Earth
    bg: 'bg-[#FDF2E9]',
    duration: 'Days 1-5',
    description: 'Slow down, soothe, survive gently. Focus on rest, iron, and warmth.',
    theme: 'Slow down, soothe, survive gently',
    sections: [
      {
        title: 'Movement & Exercise',
        icon: Dumbbell,
        color: 'text-[#95714F]',
        bg: 'bg-[#FDF2E9]',
        items: ['Gentle yoga', 'Yin yoga', 'Stretching', 'Low intensity workout', 'Walking (short + slow)', 'Nature walk']
      },
      {
        title: 'Daily Habits & Self-Care',
        icon: Lightbulb,
        color: 'text-[#8C916C]',
        bg: 'bg-[#F0F4F0]',
        items: ['Morning routine (simplified)', 'Nourishing serum', 'Hydrating face mist', 'Soothing face mask', 'Skin care', 'Baths', 'Regular cleansing', 'Comfort food', 'Heating pad', 'Avoid waxing']
      },
      {
        title: 'Emotional & Nervous System',
        icon: Heart,
        color: 'text-[#C7AF94]',
        bg: 'bg-[#EADED0]',
        items: ['Alone time', 'Comfy clothes', 'Calming playlists', 'Aromatherapy (Rose/Lavender)', 'Meditation', 'Visualisation', 'Journaling', 'Affirmations', 'Napping/Rest', 'Comedy shows', 'Focus on less tasks', 'Avoid tight deadlines']
      },
      {
        title: 'Nutrition',
        icon: Utensils,
        color: 'text-[#4A3728]',
        bg: 'bg-card',
        categories: [
          { name: 'Fruits', items: ['Banana', 'Apple', 'Pear', 'Blueberries', 'Blackberries', 'Figs', 'Cherries'] },
          { name: 'Greens & Veggies', items: ['Beets', 'Carrot', 'Squash', 'Pumpkin', 'Mushrooms', 'Onion', 'Spinach', 'Kale', 'Raspberry leaf tea'] },
          { name: 'Proteins & Grains', items: ['Red meat', 'Beef', 'Liver', 'Eggs', 'Lentils', 'Beans', 'Oats', 'Brown rice', 'Buckwheat', 'Quinoa'] },
          { name: 'Supplements', items: ['Iron', 'Magnesium', 'Zinc', 'Vitamin B/D', 'Omega-3', 'Collagen', 'Sea salt'] }
        ]
      }
    ]
  },
  'follicular': {
    name: 'Follicular Phase',
    icon: Lightbulb,
    color: 'text-[#8C916C]', // Moss
    bg: 'bg-[#F0F4F0]',
    duration: 'Days 6-13',
    description: 'Post-period energy. Fresh curiosity, light, playful, and exploratory.',
    theme: 'Light, playful, exploratory',
    sections: [
      {
        title: 'Movement & Exercise',
        icon: Dumbbell,
        color: 'text-[#8C916C]',
        bg: 'bg-[#F0F4F0]',
        items: ['Walking', 'Pilates', 'Yoga', 'Reformer pilates', 'Cycling', 'Swimming', 'Skating', 'Hiking']
      },
      {
        title: 'Daily Habits & Self-Care',
        icon: Lightbulb,
        color: 'text-[#ACB087]',
        bg: 'bg-card',
        items: ['Morning routine', 'Gratitude practice', 'Reading', 'Meal prep', 'Skin care']
      },
      {
        title: 'Social & Creative',
        icon: Target,
        color: 'text-[#95714F]',
        bg: 'bg-[#FDF2E9]',
        items: ['Start new projects', 'Planning', 'Personal growth', 'Creativity projects', 'Cooking experiments', 'Gardening', 'Declutter', 'Day trips']
      },
      {
        title: 'Nutrition',
        icon: Utensils,
        color: 'text-[#4A3728]',
        bg: 'bg-card',
        categories: [
          { name: 'Fruits', items: ['Kiwi', 'Grapefruit', 'Lemon/Lime', 'Orange', 'Strawberries', 'Mango', 'Pineapple'] },
          { name: 'Greens & Veggies', items: ['Arugula', 'Cucumber', 'Sprouts', 'Celery', 'Fennel', 'Tomatoes', 'Bell pepper'] },
          { name: 'Proteins & Grains', items: ['Edamame', 'Tofu', 'Protein powder', 'Chickpeas', 'Quinoa', 'Buckwheat', 'Black rice'] },
          { name: 'Drinks & Extras', items: ['Fresh juice', 'Peppermint', 'Matcha', 'Kefir', 'Sauerkraut', 'Miso', 'Vitamin C', 'Zinc'] }
        ]
      }
    ]
  },
  'ovulatory': {
    name: 'Ovulatory Phase',
    icon: Activity,
    color: 'text-[#4A3728]', // Dark Earth
    bg: 'bg-[#EADED0]',
    duration: 'Days 14-16',
    description: 'Peak energy. Social, expressive, bold connection and confidence.',
    theme: 'Social, expressive, bold',
    sections: [
      {
        title: 'Movement & Exercise',
        icon: Dumbbell,
        color: 'text-[#4A3728]',
        bg: 'bg-[#EADED0]',
        items: ['Cardio', 'Running', 'Strength training', 'Boot camp', 'Spinning', 'Climbing']
      },
      {
        title: 'Daily Habits & Self-Care',
        icon: Lightbulb,
        color: 'text-[#8C916C]',
        bg: 'bg-[#F0F4F0]',
        items: ['Full routines', 'Skin care glow-ups', 'Sunscreen (important)']
      },
      {
        title: 'Social & Creative',
        icon: Users,
        color: 'text-[#C7AF94]',
        bg: 'bg-card',
        items: ['Social activities', 'Brunch/Restaurants', 'Live music', 'Collaborative tasks', 'Set goals', 'Financial plans', 'Difficult conversations', 'Vacation']
      },
      {
        title: 'Nutrition',
        icon: Utensils,
        color: 'text-[#4A3728]',
        bg: 'bg-[#FDF2E9]',
        categories: [
          { name: 'Fruits', items: ['Watermelon', 'Grapes', 'Apricots', 'Peaches', 'Berries', 'Strawberries'] },
          { name: 'Greens & Veggies', items: ['Leafy greens', 'Arugula', 'Spinach', 'Kale', 'Cauliflower', 'Tomatoes', 'Bell pepper'] },
          { name: 'Proteins & Fats', items: ['Salmon', 'Fish', 'Tuna', 'Poultry', 'Eggs', 'Tofu', 'Healthy fats', 'Avocado'] },
          { name: 'Drinks & Extras', items: ['Turmeric', 'Matcha', 'Coffee', 'Omega-3', 'Vitamin C/D', 'Collagen', 'Kimchi'] }
        ]
      }
    ]
  },
  'luteal': {
    name: 'Luteal Phase',
    icon: Moon,
    color: 'text-[#95714F]', // Earth
    bg: 'bg-[#FDF2E9]',
    duration: 'Days 17-28',
    description: 'Pre-period grounding. Cozy productivity and protecting your boundaries.',
    theme: 'Cozy productivity + boundaries',
    sections: [
      {
        title: 'Movement & Exercise',
        icon: Dumbbell,
        color: 'text-[#95714F]',
        bg: 'bg-[#FDF2E9]',
        items: ['Pilates', 'Yoga', 'Walking', 'Swimming', 'Cycling', 'Hiking (short)']
      },
      {
        title: 'Daily Habits & Self-Care',
        icon: Lightbulb,
        color: 'text-[#8C916C]',
        bg: 'bg-[#F0F4F0]',
        items: ['Meal prep', 'Gratitude practice', 'Reading', 'Baths', 'Regular cleansing', 'Comfort food']
      },
      {
        title: 'Mindset & Emotional',
        icon: Heart,
        color: 'text-[#C7AF94]',
        bg: 'bg-[#EADED0]',
        items: ['Journaling', 'Meditation', 'Visualisation', 'Aromatherapy', 'Massage', 'Rest/Sleep', 'Avoid tight deadlines', 'Practical Life Stuff (Planning, Finances, Decluttering)']
      },
      {
        title: 'Nutrition',
        icon: Utensils,
        color: 'text-[#4A3728]',
        bg: 'bg-card',
        categories: [
          { name: 'Fruits & Veggies', items: ['Banana', 'Apple', 'Pear', 'Berries', 'Squash', 'Sweet potatoes', 'Carrot', 'Kale', 'Spinach', 'Mushrooms'] },
          { name: 'Proteins & Grains', items: ['Chickpeas', 'Beans', 'Lentils', 'Eggs', 'Poultry', 'Beef', 'Oats', 'Brown rice', 'Buckwheat'] },
          { name: 'Nuts & Fats', items: ['Walnuts', 'Almonds', 'Flax seed', 'Chia', 'Healthy fats', 'Avocado', 'Olive oil'] },
          { name: 'Drinks & Extras', items: ['Cinnamon', 'Warm tea', 'Ginger tea', 'Lemon balm', 'Magnesium', 'Ashwagandha', 'Vitamin B'] }
        ]
      }
    ]
  }
};

const CyclePhaseDetail: React.FC = () => {
  const { phaseId } = useParams<{ phaseId: string }>();
  const navigate = useNavigate();
  const phase = PHASE_DATA[phaseId || 'menstrual'];

  if (!phase) return <div className="p-12 text-center font-bold">Phase not found</div>;

  return (
    <div className="min-h-screen bg-card pb-24">
      <header className="sticky top-0 z-30 bg-card/80 p-6 flex items-center gap-4">
        <button 
          onClick={() => navigate(-1)}
          className={cn("p-2 rounded-full transition-all", phase.bg, phase.color)}
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="space-y-0.5">
          <h1 className={cn("text-xl font-black tracking-tighter", phase.color)}>{phase.name}</h1>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{phase.duration}</p>
        </div>
      </header>

      <main className="p-6 space-y-8 max-w-2xl mx-auto">
        {/* Intro Card */}
        <div className="p-8 rounded-sm bg-card border border-border shadow-sm space-y-4">
          <div className={cn("p-4 rounded-3xl w-fit shadow-inner", phase.bg, phase.color)}>
            <phase.icon className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">Theme</h2>
            <p className="text-2xl font-black tracking-tight text-[#4A3728]">
              {phase.theme}
            </p>
          </div>
          <p className="text-sm text-muted-foreground font-medium leading-relaxed">
            {phase.description}
          </p>
        </div>

        {/* Categories */}
        <div className="grid gap-8">
          {phase.sections.map((section: any, idx: number) => (
            <section key={idx} className="space-y-4">
              <div className="flex items-center gap-3 px-2">
                <div className={cn("p-2 rounded-xl bg-card border shadow-sm", section.color)}>
                  <section.icon className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-black tracking-tight text-[#4A3728]">{section.title}</h3>
              </div>
              
              <div className={cn("p-8 rounded-sm border shadow-sm space-y-6", section.bg, section.bg.replace('bg-', 'border-'))}>
                {section.items && (
                  <div className="flex flex-wrap gap-2">
                    {section.items.map((item: string, i: number) => (
                      <span key={i} className="px-4 py-2 rounded-full bg-card/60 text-xs font-bold uppercase tracking-widest text-[#4A3728]/70 border border-border">
                        {item}
                      </span>
                    ))}
                  </div>
                )}

                {section.categories && (
                  <div className="grid gap-6">
                    {section.categories.map((cat: any, i: number) => (
                      <div key={i} className="space-y-3">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#4A3728]/50 ml-1">{cat.name}</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {cat.items.map((item: string, j: number) => (
                            <span key={j} className="px-3 py-1.5 rounded-xl bg-card/40 text-[11px] font-bold text-[#4A3728]/80">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>

        <footer className="p-10 rounded-sm bg-[#EADED0] border-2 border-dashed border-[#C7AF94] text-center space-y-6">
          <div className="p-5 rounded-full bg-card text-[#8C916C] w-fit mx-auto shadow-md">
            <Heart className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h3 className="font-black text-[#4A3728]">Listen to your body</h3>
            <p className="text-xs text-[#95714F] font-bold uppercase tracking-widest leading-relaxed max-w-[280px] mx-auto">
              These are rituals to help you find your unique biological rhythm.
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
};

export default CyclePhaseDetail;
