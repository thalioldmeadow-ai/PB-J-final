import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Plus, Trash2, CheckCircle2, Circle, ShoppingBag, Filter, Tag } from '../components/icons';
import { cn } from '../lib/utils';
import VoiceButton from '../components/VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';
import { useAuth } from '../components/AuthProvider';
import { storage } from '../lib/storage';

interface ShoppingItem {
  id: string;
  name: string;
  category: string;
  completed: boolean;
  uid: string;
  createdAt: string;
}

const CATEGORIES = [
  'Fruits & Veg',
  'Frozen',
  'Drinks',
  'Spices',
  'Breakfast',
  'Chips & Crackers',
  'Dairy',
  'Meat & Poultry',
  'Bakery',
  'Other'
];

const ShoppingList: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [newItemName, setNewItemName] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(CATEGORIES[0]);
  const [filterCategory, setFilterCategory] = useState<string | 'All'>('All');
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    const unsub = storage.subscribe('serene_shopping_list', (data) => {
      setItems(data as ShoppingItem[]);
    });
    return () => unsub();
  }, []);

  const addItem = async () => {
    if (!newItemName.trim()) return;
    try {
      await storage.add('serene_shopping_list', {
        uid: user?.uid || 'guest',
        name: newItemName.trim(),
        category: selectedCategory,
        completed: false,
        createdAt: new Date().toISOString()
      });
      setNewItemName('');
      setIsAdding(false);
    } catch (error) {
      console.error('Error adding shopping item:', error);
    }
  };

  const toggleItem = async (item: ShoppingItem) => {
    try {
      await storage.update('serene_shopping_list', item.id, { completed: !item.completed });
    } catch (error) {
      console.error('Error toggling shopping item:', error);
    }
  };

  const deleteItem = async (id: string) => {
    try {
      await storage.delete('serene_shopping_list', id);
    } catch (error) {
      console.error('Error deleting shopping item:', error);
    }
  };

  const sortedItems = [...items].sort((a, b) => {
    if (a.completed === b.completed) return 0;
    return a.completed ? 1 : -1;
  }).filter(item => filterCategory === 'All' || item.category === filterCategory);

  return (
    <div className="min-h-screen bg-card pb-24">
      <header className="sticky top-0 z-30 bg-card/80 p-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate(-1)}
            className="p-2 text-[#8B5E3C] hover:bg-[#8B5E3C]/10 rounded-full transition-all"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold text-[#8B5E3C] tracking-tight">Shopping List</h1>
        </div>
        <div className="p-2 rounded-full bg-primary/10 text-primary">
          <ShoppingBag className="w-5 h-5" />
        </div>
      </header>

      <main className="p-6 space-y-6">
        {/* Filter */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          <button
            onClick={() => setFilterCategory('All')}
            className={cn(
              "px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap border",
              filterCategory === 'All' 
                ? "bg-primary text-primary-foreground border-primary shadow-sm" 
                : "bg-card text-muted-foreground border-border hover:border-primary/50"
            )}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={cn(
                "px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap border",
                filterCategory === cat 
                  ? "bg-primary text-primary-foreground border-primary shadow-sm" 
                  : "bg-card text-muted-foreground border-border hover:border-primary/50"
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Add Item Form */}
        <div className="p-6 rounded-sm bg-card border border-border shadow-sm space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Add New Item</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="e.g., Almond Milk"
                className="flex-1 p-4 rounded-2xl bg-muted/50 border-none focus:ring-2 focus:ring-primary text-sm"
                onKeyDown={(e) => e.key === 'Enter' && addItem()}
              />
              <VoiceButton
                onTranscript={(text) => setNewItemName(prev => appendDictation(prev, text))}
                className="p-4 rounded-2xl bg-muted/50"
                label="Dictate an item"
              />
              <button 
                onClick={addItem}
                aria-label="Add item"
                className="p-4 rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-all"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Category</label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.slice(0, 4).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all",
                    selectedCategory === cat ? "bg-secondary text-secondary-foreground border-secondary" : "bg-muted/30 text-muted-foreground border-transparent"
                  )}
                >
                  {cat}
                </button>
              ))}
              <select 
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="col-span-2 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border bg-muted/30 text-muted-foreground border-transparent outline-none px-2"
              >
                {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {sortedItems.map((item) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={cn(
                  "p-4 rounded-3xl border transition-all duration-300 flex items-center justify-between gap-4",
                  item.completed ? "bg-muted/30 border-transparent opacity-60" : "bg-card border-border shadow-sm"
                )}
              >
                <div className="flex items-center gap-4 flex-1">
                  <button 
                    onClick={() => toggleItem(item)}
                    className={cn(
                      "p-1 rounded-full transition-all",
                      item.completed ? "text-primary" : "text-muted-foreground hover:text-primary"
                    )}
                  >
                    {item.completed ? <CheckCircle2 className="w-6 h-6" /> : <Circle className="w-6 h-6" />}
                  </button>
                  <div className="space-y-0.5">
                    <span className={cn(
                      "text-sm font-bold tracking-tight transition-all",
                      item.completed && "line-through text-muted-foreground"
                    )}>
                      {item.name}
                    </span>
                    <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest text-muted-foreground/60">
                      <Tag className="w-2 h-2" />
                      {item.category}
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => deleteItem(item.id)}
                  className="p-2 text-muted-foreground hover:text-red-500 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {items.length === 0 && (
            <div className="text-center py-12 bg-muted/20 rounded-sm border border-dashed border-border">
              <ShoppingBag className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-20" />
              <p className="text-sm text-muted-foreground font-medium">Your shopping list is empty</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ShoppingList;
