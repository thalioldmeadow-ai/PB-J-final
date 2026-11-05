import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Trash2, ChevronLeft, ChevronRight, CheckCircle2, Circle } from '../components/icons';
import { cn } from '../lib/utils';
import VoiceButton from '../components/VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';
import { useAuth } from '../components/AuthProvider';
import { storage } from '../lib/storage';
import AiAssist from '../components/AiAssist';

interface ListItem {
  id: string;
  text: string;
  completed: boolean;
}

interface List {
  id: string;
  uid: string;
  title: string;
  items: ListItem[];
  order: number;
}

const Lists: React.FC = () => {
  const { user } = useAuth();
  const [lists, setLists] = useState<List[]>([]);
  const [activeListIndex, setActiveListIndex] = useState(0);
  const [newItemText, setNewItemText] = useState('');
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');

  useEffect(() => {
    const unsub = storage.subscribe(storage.key.LISTS, (data) => {
      const listData = data as List[];
      setLists(listData);
      if (listData.length > 0 && activeListIndex >= listData.length) {
        setActiveListIndex(0);
      }
    });
    return () => unsub();
  }, [activeListIndex]);

  const activeList = lists[activeListIndex];

  const createList = async () => {
    if (!newListTitle.trim()) return;
    try {
      await storage.add(storage.key.LISTS, {
        uid: user?.uid || 'guest',
        title: newListTitle.trim(),
        items: [],
        order: lists.length
      });
      setNewListTitle('');
      setIsCreatingList(false);
      setActiveListIndex(lists.length);
    } catch (error) {
      console.error('Error creating list:', error);
    }
  };

  const addItem = async () => {
    if (!activeList || !newItemText.trim()) return;
    const newItem = { id: Date.now().toString(), text: newItemText.trim(), completed: false };
    try {
      await storage.update(storage.key.LISTS, activeList.id, {
        items: [...activeList.items, newItem]
      });
      setNewItemText('');
    } catch (error) {
      console.error("Error adding item:", error);
    }
  };

  const toggleItem = async (itemId: string) => {
    if (!activeList) return;
    const newItems = activeList.items.map(i => i.id === itemId ? { ...i, completed: !i.completed } : i);
    try {
      await storage.update(storage.key.LISTS, activeList.id, { items: newItems });
    } catch (error) {
      console.error('Error toggling item:', error);
    }
  };

  const deleteItem = async (itemId: string) => {
    if (!activeList) return;
    const newItems = activeList.items.filter(i => i.id !== itemId);
    try {
      await storage.update(storage.key.LISTS, activeList.id, { items: newItems });
    } catch (error) {
      console.error('Error deleting item:', error);
    }
  };

  const deleteList = async () => {
    if (!activeList) return;
    try {
      await storage.delete(storage.key.LISTS, activeList.id);
      setActiveListIndex(Math.max(0, activeListIndex - 1));
    } catch (error) {
      console.error('Error deleting list:', error);
    }
  };

  const nextList = () => setActiveListIndex((prev) => (prev + 1) % lists.length);
  const prevList = () => setActiveListIndex((prev) => (prev - 1 + lists.length) % lists.length);

  if (lists.length === 0 && !isCreatingList) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-6 text-center">
        <div className="p-6 rounded-full bg-muted text-muted-foreground">
          <Plus className="w-12 h-12" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold">No lists yet</h2>
          <p className="text-sm text-muted-foreground">Create a list to start capturing your thoughts.</p>
        </div>
        <button
          onClick={() => setIsCreatingList(true)}
          className="btn btn-primary px-8"
        >
          Create First List
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* List Header with Navigation */}
      {isCreatingList ? (
        <div className="bg-card p-6 rounded-sm border border-primary shadow-sm space-y-4">
          <div className="relative">
            <input
              autoFocus
              type="text"
              value={newListTitle}
              onChange={(e) => setNewListTitle(e.target.value)}
              placeholder="List Title (e.g., Brain Dump)"
              className="w-full p-2 pr-12 bg-transparent text-xl font-bold focus:outline-none text-center"
              onKeyDown={(e) => e.key === 'Enter' && createList()}
            />
            <VoiceButton
              className="absolute right-1 top-1/2 -translate-y-1/2"
              onTranscript={(text) => setNewListTitle(prev => appendDictation(prev, text))}
              label="Dictate list title"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setIsCreatingList(false)} className="flex-1 py-2 rounded-xl bg-muted text-xs font-bold uppercase tracking-widest">Cancel</button>
            <button onClick={createList} className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest">Create</button>
          </div>
        </div>
      ) : (
        <div className="flex justify-between items-center bg-card p-6 rounded-sm border border-border shadow-sm">
          <button onClick={prevList} aria-label="Previous list" className="p-2 rounded-full hover:bg-muted transition-all text-muted-foreground">
            <ChevronLeft className="w-6 h-6" />
          </button>
          
          <div className="text-center space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-secondary">List {activeListIndex + 1} of {lists.length}</span>
            <h2 className="text-xl font-bold tracking-tight text-primary">{activeList?.title}</h2>
          </div>

          <button onClick={nextList} aria-label="Next list" className="p-2 rounded-full hover:bg-muted transition-all text-muted-foreground">
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      )}

      <AiAssist
        title={`Help with ${activeList?.title || 'this list'}`}
        description="Only this list and its open items are sent. Anything the assistant suggests is added after you confirm."
        mode="lists"
        allowActions={['addListItem']}
        suggestions={[
          { label: 'Organise this list', prompt: 'Group these items in a sensible order for me.' },
          { label: 'What is missing?', prompt: 'What might I be forgetting for this list?' },
          { label: 'Add an item', prompt: 'Add milk to this list.' },
        ]}
        context={async () => ({
          list: activeList
            ? {
                title: activeList.title,
                items: (activeList.items || []).slice(0, 20).map((item) => ({ text: item.text, done: item.completed })),
              }
            : null,
        })}
      />

      {/* List Items */}
      <div className="space-y-3 pb-32">
        <AnimatePresence mode="popLayout">
          {activeList?.items.map((item, idx) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2, delay: idx * 0.05 }}
              className={cn(
                "group flex items-center gap-4 p-4 rounded-2xl border border-border bg-card transition-all duration-300",
                item.completed ? "opacity-60 bg-muted/30" : "hover:shadow-md"
              )}
            >
              <button onClick={() => toggleItem(item.id)} className="flex-shrink-0">
                {item.completed ? (
                  <CheckCircle2 className="w-6 h-6 text-primary fill-primary/10" />
                ) : (
                  <Circle className="w-6 h-6 text-muted-foreground" />
                )}
              </button>
              
              <span className={cn(
                "flex-1 text-sm font-medium",
                item.completed && "line-through text-muted-foreground"
              )}>
                {item.text}
              </span>

              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                <button onClick={() => deleteItem(item.id)} className="p-1 hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        
        {!isCreatingList && (
          <div className="flex justify-center pt-4">
            <button 
              onClick={() => setIsCreatingList(true)}
              className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors flex items-center gap-2"
            >
              <Plus className="w-3 h-3" />
              New List
            </button>
            <span className="mx-4 text-muted-foreground/20">|</span>
            <button 
              onClick={deleteList}
              className="text-[10px] font-bold uppercase tracking-widest text-red-400 hover:text-red-500 transition-colors flex items-center gap-2"
            >
              <Trash2 className="w-3 h-3" />
              Delete List
            </button>
          </div>
        )}
      </div>

      {/* Add Item Input */}
      <div className="fixed bottom-24 left-6 right-6 max-w-md mx-auto z-10">
        <div className="flex gap-2 p-2 rounded-sm bg-background/80 border border-border shadow-xl">
          <input
            type="text"
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            placeholder="Capture a thought..."
            className="flex-1 px-4 py-3 bg-transparent text-sm focus:outline-none"
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
          />
          <VoiceButton
            size="sm"
            className="p-3 rounded-full hover:bg-muted text-muted-foreground"
            onTranscript={(text) => setNewItemText(prev => appendDictation(prev, text))}
            label="Dictate a list item"
          />
          <button
            onClick={addItem}
            aria-label="Add list item"
            className="p-3 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-all"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Lists;
