import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Trash2, Save, Palette, Clock, ListTodo, Plus, Check, Circle } from './icons';
import { Task } from '../types';
import { cn } from '../lib/utils';
import VoiceButton from './VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';

interface TaskEditModalProps {
  task: Task;
  onClose: () => void;
  onSave: (updatedTask: Partial<Task>) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
}

const COLORS = [
  { name: 'Earth', value: '#95714F' },
  { name: 'Moss', value: '#8C916C' },
  { name: 'Sand', value: '#C7AF94' },
  { name: 'Almond', value: '#EADED0' },
  { name: 'Sage', value: '#ACB087' },
  { name: 'Dark Earth', value: '#4A3728' },
  { name: 'Pink', value: '#D8B5AE' },
  { name: 'Peach', value: '#DCC6B4' },
  { name: 'Yellow', value: '#E3D6B8' },
  { name: 'Green', value: '#CBD3B6' },
  { name: 'Cyan', value: '#B9CDCB' },
  { name: 'Lavender', value: '#C9BEB4' },
];

const TaskEditModal: React.FC<TaskEditModalProps> = ({ task, onClose, onSave, onDelete }) => {
  const [title, setTitle] = useState(task.title);
  const [time, setTime] = useState(task.time || '09:00 AM');
  const [duration, setDuration] = useState(task.duration || 30);
  const [color, setColor] = useState(task.color || '#D8B5AE');
  const [subtasks, setSubtasks] = useState(task.subtasks || []);
  const [newSubtask, setNewSubtask] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    await onSave({
      title,
      time,
      duration,
      color,
      subtasks,
    });
    setIsSaving(false);
    onClose();
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(task.id);
      // Deleting removes the record everywhere, so the editor has nothing left to show
      onClose();
    } catch (error) {
      console.error('Error deleting event:', error);
      setIsDeleting(false);
    }
  };

  const addSubtask = () => {
    if (!newSubtask.trim()) return;
    setSubtasks([...subtasks, { id: Math.random().toString(36).substr(2, 9), title: newSubtask, completed: false }]);
    setNewSubtask('');
  };

  const toggleSubtask = (id: string) => {
    setSubtasks(subtasks.map(s => s.id === id ? { ...s, completed: !s.completed } : s));
  };

  const removeSubtask = (id: string) => {
    setSubtasks(subtasks.filter(s => s.id !== id));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="w-full max-w-lg bg-background rounded-t-[3rem] sm:rounded-sm border border-border shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-8 space-y-8 max-h-[80vh] overflow-y-auto scrollbar-hide">
          <header className="flex justify-between items-center">
            <h2 className="text-2xl font-black tracking-tighter">Edit Event</h2>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-muted transition-colors">
              <X className="w-6 h-6" />
            </button>
          </header>

          <div className="space-y-6">
            {/* Title */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Event Name</label>
              <div className="relative">
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full p-4 pr-14 rounded-2xl bg-secondary/50 border border-border font-bold text-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="What are we doing?"
                />
                <VoiceButton
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  onTranscript={(text) => setTitle(prev => appendDictation(prev, text))}
                  label="Dictate event name"
                />
              </div>
            </div>

            {/* Time & Duration */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Start Time</label>
                <div className="relative">
                  <Clock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={time}
                    onChange={e => setTime(e.target.value)}
                    className="w-full p-4 pl-12 rounded-2xl bg-secondary/50 border border-border font-bold text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2">Duration (min)</label>
                <input
                  type="number"
                  value={duration}
                  onChange={e => setDuration(parseInt(e.target.value) || 0)}
                  className="w-full p-4 rounded-2xl bg-secondary/50 border border-border font-bold text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {/* Color Picker */}
            <div className="space-y-3">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2 flex items-center gap-2">
                <Palette className="w-3 h-3" /> Event Color
              </label>
              <div className="flex flex-wrap gap-3 p-2">
                {COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setColor(c.value)}
                    style={{ backgroundColor: c.value }}
                    className={cn(
                      "w-8 h-8 rounded-full transition-all duration-300 relative border border-black/5",
                      color === c.value ? "scale-125 ring-4 ring-primary/20" : ""
                    )}
                  >
                    {color === c.value && <Check className={cn("w-4 h-4 absolute inset-0 m-auto", ['#95714F', '#8C916C'].includes(c.value) ? "text-primary-foreground" : "text-black/60")} />}
                  </button>
                ))}
              </div>
            </div>

            {/* Subtasks */}
            <div className="space-y-4">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-2 flex items-center gap-2">
                <ListTodo className="w-3 h-3" /> Sub-tasks
              </label>
              
              <div className="space-y-2">
                {subtasks.map((st) => (
                  <div key={st.id} className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 group">
                    <button onClick={() => toggleSubtask(st.id)}>
                      {st.completed ? (
                        <Check className="w-5 h-5 text-primary" />
                      ) : (
                        <Circle className="w-5 h-5 text-muted-foreground" />
                      )}
                    </button>
                    <span className={cn("flex-1 text-sm font-medium", st.completed && "line-through text-muted-foreground")}>
                      {st.title}
                    </span>
                    <button onClick={() => removeSubtask(st.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-500 hover:bg-rose-50 rounded-lg transition-all">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSubtask}
                  onChange={e => setNewSubtask(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addSubtask()}
                  placeholder="Add a step..."
                  className="flex-1 p-3 rounded-xl bg-secondary/30 border border-border text-sm focus:outline-none"
                />
                <VoiceButton
                  size="sm"
                  className="p-3 rounded-xl bg-secondary/30 border border-border"
                  onTranscript={(text) => setNewSubtask(prev => appendDictation(prev, text))}
                  label="Dictate a step"
                />
                <button
                  onClick={addSubtask}
                  aria-label="Add step"
                  className="p-3 rounded-xl bg-primary text-primary-foreground transition-all"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          <footer className="flex gap-4 pt-4">
            <button
              onClick={handleDelete}
              disabled={isDeleting || isSaving}
              className="flex-1 py-4 rounded-2xl bg-rose-50 text-rose-500 font-bold text-xs uppercase tracking-widest hover:bg-rose-100 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" /> {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-[2] py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" /> {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </footer>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default TaskEditModal;
