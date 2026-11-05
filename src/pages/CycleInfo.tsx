import React from 'react';
import { motion } from 'motion/react';
import { Info, Heart, Lightbulb, Droplets, Activity, Moon, ChevronLeft, ChevronRight } from '../components/icons';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';

const CycleInfo: React.FC = () => {
  const phases = [
    {
      name: 'Menstrual Phase',
      icon: Droplets,
      color: 'text-[#95714F]', // Earth
      bg: 'bg-[#FDF2E9]',
      description: 'Slow down, soothe, survive gently. Focus on rest, iron, and warmth.',
      tips: ['Rest', 'Iron-rich foods', 'Warmth']
    },
    {
      name: 'Follicular Phase',
      icon: Lightbulb,
      color: 'text-[#8C916C]', // Moss
      bg: 'bg-[#F0F4F0]',
      description: 'Light, playful, exploratory energy returns. New projects and fresh foods.',
      tips: ['Planning', 'New projects', 'Movement']
    },
    {
      name: 'Ovulatory Phase',
      icon: Activity,
      color: 'text-[#4A3728]', // Dark Earth
      bg: 'bg-[#EADED0]',
      description: 'Peak social, expressive, and bold energy. Radiant confidence.',
      tips: ['Socializing', 'Peak performance', 'Connection']
    },
    {
      name: 'Luteal Phase',
      icon: Moon,
      color: 'text-[#95714F]', // Earth
      bg: 'bg-[#FDF2E9]',
      description: 'Cozy productivity and grounding. Protecting boundaries and stabilizing.',
      tips: ['Completion', 'Meal prep', 'Self-care']
    }
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      <header className="flex items-center gap-4">
        <Link to="/health/cycle">
          <button className="p-3 rounded-full bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary transition-all">
            <ChevronLeft className="w-5 h-5" />
          </button>
        </Link>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary">
            <Info className="w-5 h-5" />
            <h1 className="text-2xl font-black tracking-tighter">Cycle Education</h1>
          </div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Understand your rhythm</p>
        </div>
      </header>

      <section className="p-8 rounded-sm bg-primary text-primary-foreground shadow-xl shadow-primary/20 space-y-4">
        <div className="p-4 rounded-full bg-card/20 w-fit">
          <Heart className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-black tracking-tight">The Four Seasons</h2>
          <p className="text-sm font-medium leading-relaxed opacity-90">
            Your cycle is like the four seasons. Each phase brings different strengths and needs. 
            By syncing your schedule with your cycle, you can work with your body instead of against it.
          </p>
        </div>
      </section>

      <div className="space-y-6">
        {phases.map((phase, index) => (
          <Link 
            key={index} 
            to={`/health/cycle/phase/${phase.name.split(' ')[0].toLowerCase()}`}
            className="block"
          >
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ x: 4 }}
              className={cn(
                "p-6 rounded-sm border-2 shadow-sm space-y-4 group transition-all",
                phase.bg,
                phase.bg.replace('bg-', 'border-')
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`p-4 rounded-2xl bg-card/40 ${phase.color}`}>
                    <phase.icon className="w-6 h-6" />
                  </div>
                  <h3 className={cn("text-lg font-bold tracking-tight", phase.color)}>{phase.name}</h3>
                </div>
                <ChevronRight className={cn("w-5 h-5 transition-all", phase.color)} />
              </div>
              
              <p className={cn("text-sm font-medium leading-relaxed opacity-80", phase.color)}>
                {phase.description}
              </p>

              <div className="flex flex-wrap gap-2">
                {phase.tips.map((tip, i) => (
                  <span key={i} className="px-3 py-1 rounded-full bg-card/30 text-[10px] font-bold uppercase tracking-widest opacity-70">
                    {tip}
                  </span>
                ))}
              </div>
            </motion.div>
          </Link>
        ))}
      </div>

      <footer className="p-8 rounded-sm bg-secondary/30 border border-border/50 text-center space-y-4">
        <div className="p-4 rounded-full bg-secondary text-secondary-foreground w-fit mx-auto">
          <Lightbulb className="w-8 h-8" />
        </div>
        <div className="space-y-1">
          <h3 className="font-bold tracking-tight">Cycle Syncing</h3>
          <p className="text-xs text-muted-foreground font-medium max-w-[240px] mx-auto leading-relaxed">
            Try adjusting your "Today's Focus" based on your current phase for a more serene and productive life.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default CycleInfo;
