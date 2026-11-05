import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Heart, Lightbulb, MessageSquare, Plus, Trash2, ChevronRight, ChevronLeft, 
  Calendar, Send, History, Moon, BookOpen, Compass, Feather, 
  Leaf, Smile, PenTool, Book, X, AlertCircle, Sun, Star, BookMarked,
  Lock, Eye, EyeOff, Copy, Check, ShieldCheck
} from '../components/icons';
import { cn } from '../lib/utils';
import VoiceButton from '../components/VoiceButton';
import { appendDictation } from '../hooks/useVoiceInput';
import { PROMPTS } from '../constants';
import { useAuth } from '../components/AuthProvider';
import { storage } from '../lib/storage';
import { JournalEntry, JournalBook, PasswordEntry } from '../types';
import { format } from 'date-fns';

const COVER_COLORS = [
  { id: 'sage', value: '#9CAF88', name: 'Sage Green' },
  { id: 'rose', value: '#C89B9B', name: 'Dusty Rose' },
  { id: 'indigo', value: '#2E465C', name: 'Cobalt Blue' },
  { id: 'terracotta', value: '#C27D68', name: 'Sienna Clay' },
  { id: 'lavender', value: '#B899B5', name: 'Lavender Gray' },
  { id: 'oatmeal', value: '#D9C5B2', name: 'Cream Sand' },
];

const COVER_ICONS = [
  { id: 'feather', icon: Feather, label: 'Feather' },
  { id: 'sparkles', icon: Lightbulb, label: 'Lightbulb' },
  { id: 'leaf', icon: Leaf, label: 'Leaf' },
  { id: 'heart', icon: Heart, label: 'Heart' },
  { id: 'moon', icon: Moon, label: 'Moon' },
  { id: 'sun', icon: Sun, label: 'Sun' },
  { id: 'compass', icon: Compass, label: 'Compass' },
  { id: 'bookOpen', icon: BookOpen, label: 'Book' },
];

const iconMap: Record<string, React.FC<any>> = {
  feather: Feather,
  sparkles: Lightbulb,
  leaf: Leaf,
  heart: Heart,
  moon: Moon,
  sun: Sun,
  compass: Compass,
  bookOpen: BookOpen,
};

const Journal: React.FC = () => {
  const { user } = useAuth();
  
  // Data subscriptions
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [journals, setJournals] = useState<JournalBook[]>([]);
  const [activeJournalId, setActiveJournalId] = useState<string>('');
  
  // Scribe writing buffers for vertical layout
  const [gratitudeInput, setGratitudeInput] = useState('');
  const [momentInput, setMomentInput] = useState('');
  const [promptInput, setPromptInput] = useState('');
  const [dreamInput, setDreamInput] = useState('');
  const [dumpInput, setDumpInput] = useState('');
  
  // Scribe writing buffers for book modal layout
  const [bookWriteType, setBookWriteType] = useState<'gratitude' | 'prompts' | 'dreams' | 'moments' | 'dump' | 'note' | 'journal'>('note');
  const [bookEditorInput, setBookEditorInput] = useState('');
  const [selectedDump, setSelectedDump] = useState<JournalEntry | null>(null);
  const [showAllDumps, setShowAllDumps] = useState(false);

  // Prompt cycling pointers
  const [stdPromptIdx, setStdPromptIdx] = useState(0);
  const [gratitudePromptIdx, setGratitudePromptIdx] = useState(0);
  const [dreamPromptIdx, setDreamPromptIdx] = useState(0);

  // Layout Toggle: Is the beautiful skeumorphic Book View open on a new screen?
  const [isBookViewerOpen, setIsBookViewerOpen] = useState(false);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [mobileBookTab, setMobileBookTab] = useState<'read' | 'write'>('read');

  // Modal / Creator State for shelf
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newJournalName, setNewJournalName] = useState('');
  const [newJournalColor, setNewJournalColor] = useState('#9CAF88');
  const [newJournalIcon, setNewJournalIcon] = useState('feather');

  // Deletion Confirm state
  const [journalToDeleteId, setJournalToDeleteId] = useState<string | null>(null);

  // Password vault state
  const [passwordEntries, setPasswordEntries] = useState<PasswordEntry[]>([]);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordService, setPasswordService] = useState('');
  const [passwordUsername, setPasswordUsername] = useState('');
  const [passwordValue, setPasswordValue] = useState('');
  const [passwordNotes, setPasswordNotes] = useState('');
  const [showPasswordDraft, setShowPasswordDraft] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [visiblePasswordIds, setVisiblePasswordIds] = useState<Record<string, boolean>>({});
  const [copiedPasswordId, setCopiedPasswordId] = useState<string | null>(null);
  const [passwordToDeleteId, setPasswordToDeleteId] = useState<string | null>(null);

  // Standard non-dream/non-gratitude prompts, gratitude prompts, and dream-only prompts
  const standardPrompts = PROMPTS.filter(p => p.category !== 'Dreams' && p.category !== 'Gratitude');
  const gratitudePrompts = PROMPTS.filter(p => p.category === 'Gratitude');
  const dreamPrompts = PROMPTS.filter(p => p.category === 'Dreams');

  // Load subscriptions
  useEffect(() => {
    const unsubEntries = storage.subscribe(storage.key.JOURNAL_ENTRIES, (data) => {
      const journalData = (data as JournalEntry[]).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setEntries(journalData);
    });

    const unsubPasswords = storage.subscribe(storage.key.PASSWORDS, (data) => {
      setPasswordEntries(
        (data as PasswordEntry[]).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
      );
    });

    const unsubJournals = storage.subscribe(storage.key.JOURNALS, (data) => {
      const journalBooks = data as JournalBook[];
      setJournals(journalBooks);
      
      // Auto-set first journal as active if none is currently selected
      if (journalBooks.length > 0) {
        setActiveJournalId(prev => {
          if (!prev || !journalBooks.some(j => j.id === prev)) {
            return journalBooks[0].id;
          }
          return prev;
        });
      } else {
        setActiveJournalId('');
      }
    });

    return () => {
      unsubEntries();
      unsubPasswords();
      unsubJournals();
    };
  }, []);

  // One-time self-repair migration for any legacy entries erroneously saved as 'dump' type from the book Scribe
  useEffect(() => {
    if (entries.length === 0) return;
    
    const hasRunMigration = localStorage.getItem('journal_dump_migration_run_v4');
    if (hasRunMigration) return;

    const runMigration = async () => {
      for (const entry of entries) {
        // Any 'dump' entry with content over 15 characters or multiple lines is a custom journal page.
        // Convert to 'note' type so it correctly populates the book pages layout.
        if (entry.type === 'dump' && (entry.content.length > 15 || entry.content.includes('\n'))) {
          await storage.update(storage.key.JOURNAL_ENTRIES, entry.id, { type: 'note' });
        }
      }
      localStorage.setItem('journal_dump_migration_run_v4', 'true');
    };

    runMigration();
  }, [entries]);

  // Filter prompt cycling ranges
  useEffect(() => {
    // Standard prompt default
    const firstStd = PROMPTS.findIndex(p => p.category !== 'Dreams' && p.category !== 'Gratitude');
    if (firstStd >= 0) setStdPromptIdx(firstStd);

    // Gratitude prompt default
    const firstGrat = PROMPTS.findIndex(p => p.category === 'Gratitude');
    if (firstGrat >= 0) setGratitudePromptIdx(firstGrat);

    // Dream prompt default
    const firstDream = PROMPTS.findIndex(p => p.category === 'Dreams');
    if (firstDream >= 0) setDreamPromptIdx(firstDream);
  }, []);

  const addJournal = async () => {
    if (!newJournalName.trim()) return;
    try {
      const newId = await storage.add(storage.key.JOURNALS, {
        uid: user?.uid || 'guest',
        name: newJournalName.trim(),
        coverColor: newJournalColor,
        coverIcon: newJournalIcon,
        createdAt: new Date().toISOString(),
      });
      setActiveJournalId(newId);
      setNewJournalName('');
      setNewJournalColor('#9CAF88');
      setNewJournalIcon('feather');
      setIsAddModalOpen(false);
      setCurrentPageIdx(0);
    } catch (error) {
      console.error('Error adding journal:', error);
    }
  };

  const deleteJournal = async (journalId: string) => {
    try {
      const entriesToDelete = entries.filter(e => e.journalId === journalId);
      for (const entry of entriesToDelete) {
        await storage.delete(storage.key.JOURNAL_ENTRIES, entry.id);
      }
      await storage.delete(storage.key.JOURNALS, journalId);

      const updatedJournals = journals.filter(j => j.id !== journalId);
      const wasActive = activeJournalId === journalId;
      setActiveJournalId(prev => (
        updatedJournals.some(journal => journal.id === prev)
          ? prev
          : (updatedJournals[0]?.id || '')
      ));
      setJournalToDeleteId(null);
      setCurrentPageIdx(0);
      if (wasActive) setIsBookViewerOpen(false);
    } catch (error) {
      console.error('Error deleting journal:', error);
    }
  };

  const ensureActiveJournal = async () => {
    let currentId = activeJournalId;
    if (!currentId) {
      if (journals.length === 0) {
        // Auto-create a default journal!
        try {
          const newId = await storage.add(storage.key.JOURNALS, {
            uid: user?.uid || 'guest',
            name: 'My Journal',
            coverColor: '#418252', // beautiful green
            coverIcon: 'feather',
            createdAt: new Date().toISOString(),
          });
          setActiveJournalId(newId);
          currentId = newId;
        } catch (err) {
          console.error('Error auto-creating default journal:', err);
          return '';
        }
      } else {
        currentId = journals[0].id;
        setActiveJournalId(currentId);
      }
    }
    return currentId;
  };

  const addEntry = async (type: 'gratitude' | 'prompts' | 'dreams' | 'dump' | 'moments', content: string) => {
    if (!content.trim()) return;
    try {
      const targetJournalId = await ensureActiveJournal();
      if (!targetJournalId) return;

      let promptText: string | undefined = undefined;
      if (type === 'prompts') {
        promptText = PROMPTS[stdPromptIdx]?.text;
      } else if (type === 'dreams') {
        promptText = PROMPTS[dreamPromptIdx]?.text;
      }

      await storage.add(storage.key.JOURNAL_ENTRIES, {
        uid: user?.uid || 'guest',
        type,
        content: content.trim(),
        createdAt: new Date().toISOString(),
        journalId: targetJournalId,
        ...(promptText ? { prompt: promptText } : {})
      });

      // Clear the respective input buffer
      if (type === 'gratitude') setGratitudeInput('');
      if (type === 'prompts') setPromptInput('');
      if (type === 'dreams') setDreamInput('');
      if (type === 'moments') setMomentInput('');
      if (type === 'dump') setDumpInput('');
      
      // Auto-reset page flick-index to show newest pages
      setCurrentPageIdx(0);
    } catch (error) {
      console.error('Error adding journal entry:', error);
    }
  };

  const addEntryFromBookEditor = async () => {
    if (!bookEditorInput.trim()) return;
    try {
      const targetJournalId = await ensureActiveJournal();
      if (!targetJournalId) return;

      let promptText: string | undefined = undefined;
      if (bookWriteType === 'prompts') {
        promptText = PROMPTS[stdPromptIdx]?.text;
      } else if (bookWriteType === 'dreams') {
        promptText = PROMPTS[dreamPromptIdx]?.text;
      }

      await storage.add(storage.key.JOURNAL_ENTRIES, {
        uid: user?.uid || 'guest',
        type: bookWriteType,
        content: bookEditorInput.trim(),
        createdAt: new Date().toISOString(),
        journalId: targetJournalId,
        ...(promptText ? { prompt: promptText } : {})
      });

      // Reset book input and flick back to the front-page/today's date
      setBookEditorInput('');
      setCurrentPageIdx(0);
    } catch (error) {
      console.error('Error adding entry from book editor:', error);
    }
  };



  const deleteEntry = async (id: string) => {
    try {
      await storage.delete(storage.key.JOURNAL_ENTRIES, id);
    } catch (error) {
      console.error('Error deleting journal entry:', error);
    }
  };

  const closePasswordForm = () => {
    setShowPasswordForm(false);
    setPasswordService('');
    setPasswordUsername('');
    setPasswordValue('');
    setPasswordNotes('');
    setShowPasswordDraft(false);
    setPasswordError('');
  };

  const addPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    const service = passwordService.trim();
    if (!service || !passwordValue) {
      setPasswordError('Add a name and a password.');
      return;
    }

    setPasswordError('');
    try {
      await storage.add(storage.key.PASSWORDS, {
        uid: user?.uid || 'guest',
        service,
        username: passwordUsername.trim() || undefined,
        password: passwordValue,
        notes: passwordNotes.trim() || undefined,
        createdAt: new Date().toISOString(),
      });
      closePasswordForm();
    } catch (error) {
      setPasswordError('This password could not be saved. Try again.');
    }
  };

  const deletePassword = async (id: string) => {
    try {
      await storage.delete(storage.key.PASSWORDS, id);
      setVisiblePasswordIds(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (error) {
      console.error('Error deleting password entry:', error);
    } finally {
      setPasswordToDeleteId(null);
    }
  };

  const togglePasswordVisibility = (id: string) => {
    setVisiblePasswordIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const copyPassword = async (entry: PasswordEntry) => {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(entry.password);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      const field = document.createElement('textarea');
      field.value = entry.password;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      }
      field.remove();
    }

    if (copied) {
      setCopiedPasswordId(entry.id);
      window.setTimeout(() => {
        setCopiedPasswordId(current => (current === entry.id ? null : current));
      }, 1800);
    }
  };

  const activeJournal = journals.find(j => j.id === activeJournalId);

  // Filter entries to the selected active journal only
  const filteredEntries = entries.filter(e => e.journalId === activeJournalId);

  // Journal page entries exclude dump types as requested by user
  const journalPageEntries = filteredEntries.filter(e => e.type !== 'dump');

  // Group PAST entries for this journal into "Pages" by Calendar Date
  const entriesByDate: Record<string, JournalEntry[]> = {};
  journalPageEntries.forEach((entry) => {
    const dateKey = format(new Date(entry.createdAt || Date.now()), 'EEEE, MMMM d, yyyy');
    if (!entriesByDate[dateKey]) {
      entriesByDate[dateKey] = [];
    }
    entriesByDate[dateKey].push(entry);
  });

  // Convert entries into page models sorted by date (newest first)
  const pages = Object.entries(entriesByDate)
    .map(([dateString, items]) => ({
      date: dateString,
      rawDate: new Date(items[0]?.createdAt || Date.now()),
      items: items.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
    }))
    .sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime());

  // Page index helpers for book viewer
  const hasPages = pages.length > 0;
  const currentPage = hasPages && pages[currentPageIdx] ? pages[currentPageIdx] : null;

  const goNextPage = () => {
    if (currentPageIdx < pages.length - 1) {
      setCurrentPageIdx(prev => prev + 1);
    }
  };

  const goPrevPage = () => {
    if (currentPageIdx > 0) {
      setCurrentPageIdx(prev => prev - 1);
    }
  };

  // Styled icons based on entries types
  const renderIconForType = (type: string) => {
    switch (type) {
      case 'gratitude': return <Heart className="w-3.5 h-3.5 text-rose-500 fill-current" />;
      case 'prompts': return <MessageSquare className="w-3.5 h-3.5 text-amber-500" />;
      case 'dreams': return <Star className="w-3.5 h-3.5 text-primary fill-primary" />;
      case 'moments': return <Lightbulb className="w-3.5 h-3.5 text-sky-500 fill-current" />;
      case 'dump': return <Moon className="w-3.5 h-3.5 text-primary" />;
      case 'note': return <BookOpen className="w-3.5 h-3.5 text-amber-800" />;
      case 'journal': return <BookOpen className="w-3.5 h-3.5 text-amber-805" />;
      default: return <BookOpen className="w-3.5 h-3.5" />;
    }
  };

  const renderBadgeTitleForType = (type: string) => {
    switch (type) {
      case 'gratitude': return 'Daily Gratitude';
      case 'prompts': return 'Reflective Prompt';
      case 'dreams': return 'Dream Chronicle';
      case 'moments': return 'Sweet Win';
      case 'dump': return 'Thoughts';
      case 'note': return 'Journal Entry';
      case 'journal': return 'Journal Page';
      default: return 'Reflection';
    }
  };

  // Filter entry types for current vertical view sections
  const gratitudeEntries = filteredEntries.filter(e => e.type === 'gratitude');
  const promptEntries = filteredEntries.filter(e => e.type === 'prompts');
  const dreamEntries = filteredEntries.filter(e => e.type === 'dreams');
  const momentEntries = filteredEntries.filter(e => e.type === 'moments');
  const dumpEntries = entries.filter(e => e.type === 'dump');

  return (
    <div className="space-y-8 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Top Banner indicating Active Journal & Option to Open Book View */}
      {activeJournal ? (
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-5 rounded-3xl bg-card border border-border shadow-sm">
          <div className="flex items-center gap-4">
            <div 
              className="w-10 h-12 rounded-xl relative flex items-center justify-center text-primary-foreground font-black overflow-hidden shadow-sm"
              style={{ backgroundColor: activeJournal.coverColor }}
            >
              {/* Cover spine crease */}
              <div className="absolute inset-y-0 left-0 w-2.5 bg-black/10 border-r border-black/5" />
              <div className="absolute inset-y-0 left-3 w-[0.5px] bg-card/10" />
              {/* Cover Icon */}
              {React.createElement(iconMap[activeJournal.coverIcon] || BookOpen, { className: "w-5 h-5 text-primary-foreground/95 drop-shadow-sm" })}
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">Journal Active</p>
              <h3 className="text-base font-extrabold text-foreground leading-none mt-0.5">{activeJournal.name}</h3>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto self-stretch sm:self-auto">
            {/* SPECIAL USER REQUEST POINT: Open the Journal like a normal real book on a new screen overlays! */}
            <button
              onClick={() => {
                setCurrentPageIdx(0);
                setIsBookViewerOpen(true);
              }}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-3 bg-primary hover:bg-primary text-primary-foreground rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-sm shadow-primary "
            >
              <BookOpen className="w-4 h-4 fill-current" /> Open Book View
            </button>
            
            <button 
              onClick={() => setJournalToDeleteId(activeJournal.id)}
              className="p-3 text-muted-foreground/30 hover:text-rose-500 hover:bg-rose-50 :bg-rose-950/20 rounded-2xl transition-all"
              title="Delete this Journal"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Main Journal Writing Feed - Prompts are always visible so you can start writing immediately! */}
      {journals.length === 0 && (
        <div className="p-6 bg-card border border-dashed border-border rounded-sm flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 text-primary rounded-xl">
              <BookOpen className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-foreground">Tip: Personalize Your Book Cover</h4>
              <p className="text-[10px] text-muted-foreground mt-0.5 max-w-md">
                As you type below, a journal will be created. Customize your book style from the entry list below anytime!
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="w-full sm:w-auto px-4 py-2 border-2 border-primary text-primary hover:bg-primary/5 rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all"
          >
            Create Cover Style
          </button>
        </div>
      )}

      {/* Main interactive prompting sections */}
      <div className="space-y-8">
          
          {/* Gratitude Section */}
          <section className="p-6 md:p-8 bg-card border border-border rounded-sm shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-full bg-rose-500/10 text-rose-500">
                  <Heart className="w-4 h-4 fill-current text-rose-500" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider leading-none text-foreground">Gratitude Journal</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Capturing light, silver-linings, and appreciation</p>
                </div>
              </div>
              <span className="text-[8px] font-bold uppercase tracking-widest bg-rose-50  text-rose-600 px-2 py-1 rounded">Daily</span>
            </div>

            <div className="p-5 rounded-2xl bg-rose-5/40  border border-rose-500/10 flex justify-between items-start gap-4 shadow-inner">
              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-rose-700 ">
                  Gratitude Prompt
                </span>
                <h4 className="text-xs font-bold leading-relaxed text-foreground">
                  {PROMPTS[gratitudePromptIdx]?.text || 'What is something small that made you smile today?'}
                </h4>
              </div>
              <button
                onClick={() => {
                  const items = PROMPTS.map((p, idx) => ({ p, idx })).filter(x => x.p.category === 'Gratitude');
                  const currentPos = items.findIndex(x => x.idx === gratitudePromptIdx);
                  const nextPos = (currentPos + 1) % items.length;
                  setGratitudePromptIdx(items[nextPos].idx);
                }}
                className="p-1.5 bg-background border border-border rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-all flex-shrink-0"
                title="Next Prompt"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="relative pt-1">
                <textarea
                  value={gratitudeInput}
                  onChange={(e) => setGratitudeInput(e.target.value)}
                  placeholder="Today, I am incredibly thankful for..."
                  className="w-full min-h-[100px] p-4 pb-12 rounded-2xl bg-background border border-border text-xs focus:ring-1 focus:ring-primary focus:outline-none placeholder:text-muted-foreground/45 resize-none shadow-inner"
                />
                <VoiceButton
                  size="sm"
                  className="absolute bottom-3 left-3"
                  onTranscript={(text) => setGratitudeInput(prev => appendDictation(prev, text))}
                  label="Dictate gratitude"
                />
                <button
                  onClick={() => addEntry('gratitude', gratitudeInput)}
                  disabled={!gratitudeInput.trim()}
                  className="absolute bottom-4 right-4 p-3 bg-primary text-primary-foreground rounded-xl text-xs font-black uppercase transition-all disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>

              {gratitudeEntries.length > 0 && (
                <div className="space-y-2 pt-2">
                  <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground/50">Recent gratitudes</p>
                  <div className="space-y-2">
                    <AnimatePresence mode="popLayout">
                      {gratitudeEntries.slice(0, 5).map((entry) => (
                        <motion.div
                          key={entry.id}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="p-3.5 rounded-2xl bg-secondary/20 border border-secondary/10 text-xs font-semibold text-foreground flex justify-between items-start group shadow-sm"
                        >
                          <div className="space-y-1 flex-1">
                            {entry.prompt && <p className="text-[9px] font-bold text-rose-500">Q: {entry.prompt}</p>}
                            <p className="font-medium text-foreground">{entry.content}</p>
                          </div>
                          <button 
                            onClick={() => deleteEntry(entry.id)} 
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-rose-500 flex-shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Daily Prompt Section */}
          <section className="p-6 md:p-8 bg-card border border-border rounded-sm shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-full bg-amber-500/10 text-amber-500">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider leading-none text-foreground">Self Reflection Prompt</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Letting wisdom prompt your mind</p>
                </div>
              </div>
              <span className="text-[8px] font-bold uppercase tracking-widest bg-amber-50  text-amber-600 px-2 py-1 rounded">Growth</span>
            </div>

            <div className="p-5 rounded-2xl bg-amber-50/40  border border-amber-500/10 flex justify-between items-start gap-4 shadow-inner">
              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-amber-700 ">
                  Category: {PROMPTS[stdPromptIdx]?.category || 'Self-Reflection'}
                </span>
                <h4 className="text-xs font-bold leading-relaxed text-foreground">
                  {PROMPTS[stdPromptIdx]?.text || 'What is on your mind?'}
                </h4>
              </div>
              <button
                onClick={() => {
                  const items = PROMPTS.map((p, idx) => ({ p, idx })).filter(x => x.p.category !== 'Dreams' && x.p.category !== 'Gratitude');
                  const currentPos = items.findIndex(x => x.idx === stdPromptIdx);
                  const nextPos = (currentPos + 1) % items.length;
                  setStdPromptIdx(items[nextPos].idx);
                }}
                className="p-1.5 bg-background border border-border rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                title="Next Prompt"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="relative pt-1">
              <textarea
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                placeholder="Dwell, reflect, type your answer..."
                className="w-full min-h-[100px] p-4 pb-12 rounded-2xl bg-background border border-border text-xs focus:ring-1 focus:ring-primary focus:outline-none placeholder:text-muted-foreground/45 resize-none shadow-inner"
              />
              <VoiceButton
                size="sm"
                className="absolute bottom-3 left-3"
                onTranscript={(text) => setPromptInput(prev => appendDictation(prev, text))}
                label="Dictate your reflection"
              />
              <button
                onClick={() => addEntry('prompts', promptInput)}
                disabled={!promptInput.trim()}
                className="absolute bottom-4 right-4 p-3 bg-primary text-primary-foreground rounded-xl text-xs font-black uppercase transition-all disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>

            {promptEntries.length > 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground/50">Recent reflections</p>
                <div className="space-y-2">
                  {promptEntries.slice(0, 2).map((entry) => (
                    <div key={entry.id} className="p-3.5 rounded-2xl bg-background border border-border text-xs flex justify-between items-start group">
                      <div className="space-y-1 flex-1">
                        {entry.prompt && <p className="text-[9px] font-bold text-amber-500">Q: {entry.prompt}</p>}
                        <p className="font-medium text-foreground">{entry.content}</p>
                      </div>
                      <button onClick={() => deleteEntry(entry.id)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-rose-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Dream Journal Section (Newly requested section integrated on the main tab) */}
          <section className="p-6 md:p-8 bg-card border border-border rounded-sm shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-full bg-primary/10 text-primary">
                  <Star className="w-4 h-4 fill-current text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider leading-none text-foreground">Dream Landscapes</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Seal symbols, surreal visions, and subconscious sleep logs</p>
                </div>
              </div>
              <span className="text-[8px] font-bold uppercase tracking-widest bg-primary  text-primary px-2 py-1 rounded">Night</span>
            </div>

            <div className="p-5 rounded-2xl bg-primary/40  border border-primary/10 flex justify-between items-start gap-4 shadow-inner">
              <div className="space-y-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-primary ">
                  Subconscious Prompt
                </span>
                <h4 className="text-xs font-bold leading-relaxed text-foreground">
                  {PROMPTS[dreamPromptIdx]?.text || 'What setting or colors do you remember seeing last night?'}
                </h4>
              </div>
              <button
                onClick={() => {
                  const items = PROMPTS.map((p, idx) => ({ p, idx })).filter(x => x.p.category === 'Dreams');
                  const currentPos = items.findIndex(x => x.idx === dreamPromptIdx);
                  const nextPos = (currentPos + 1) % items.length;
                  setDreamPromptIdx(items[nextPos].idx);
                }}
                className="p-1.5 bg-background border border-border rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                title="Next Dream Prompt"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="relative pt-1">
              <textarea
                value={dreamInput}
                onChange={(e) => setDreamInput(e.target.value)}
                placeholder="Log details, recurring characters, animals, settings, or mood of your dream..."
                className="w-full min-h-[100px] p-4 pb-12 rounded-2xl bg-background border border-border text-xs focus:ring-1 focus:ring-primary focus:outline-none placeholder:text-muted-foreground/45 resize-none shadow-inner"
              />
              <VoiceButton
                size="sm"
                className="absolute bottom-3 left-3"
                onTranscript={(text) => setDreamInput(prev => appendDictation(prev, text))}
                label="Dictate your dream"
              />
              <button
                onClick={() => addEntry('dreams', dreamInput)}
                disabled={!dreamInput.trim()}
                className="absolute bottom-4 right-4 p-3 bg-primary text-primary-foreground rounded-xl text-xs font-black uppercase transition-all disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>

            {dreamEntries.length > 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground/50">Dream diary entries</p>
                <div className="space-y-2">
                  {dreamEntries.slice(0, 2).map((entry) => (
                    <div key={entry.id} className="p-3.5 rounded-2xl bg-primary/5  border border-primary/10 text-xs flex justify-between items-start group">
                      <div className="space-y-1 flex-1">
                        {entry.prompt && <p className="text-[9px] font-bold text-primary">Subconscious Q: {entry.prompt}</p>}
                        <p className="font-medium text-foreground">{entry.content}</p>
                      </div>
                      <button onClick={() => deleteEntry(entry.id)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-rose-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Good Moments Section */}
          <section className="p-6 md:p-8 bg-card border border-border rounded-sm shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-full bg-sky-500/10 text-sky-500">
                  <Lightbulb className="w-4 h-4 fill-current" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider leading-none text-foreground">Captured Moments</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Register small wins, delicious bites, or sunny steps</p>
                </div>
              </div>
              <span className="text-[8px] font-bold uppercase tracking-widest bg-sky-50  text-sky-600 px-2 py-1 rounded">Sweet</span>
            </div>

            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {momentEntries.slice(0, 5).map((entry) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="p-3.5 rounded-2xl bg-secondary/20 border border-secondary/10 text-xs font-semibold text-foreground flex justify-between items-center group shadow-sm"
                  >
                    <span>{entry.content}</span>
                    <button 
                      onClick={() => deleteEntry(entry.id)} 
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-rose-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>

              <div className="flex gap-2 pt-2">
                <input
                  type="text"
                  value={momentInput}
                  onChange={(e) => setMomentInput(e.target.value)}
                  placeholder="Record a sweet small win or a comforting memory..."
                  onKeyDown={(e) => e.key === 'Enter' && addEntry('moments', momentInput)}
                  className="flex-1 p-3.5 rounded-2xl bg-background border border-border text-xs focus:ring-1 focus:ring-primary focus:outline-none placeholder:text-muted-foreground/45 shadow-inner"
                />
                <VoiceButton
                  size="sm"
                  className="p-3.5 rounded-2xl bg-background border border-border shadow-inner"
                  onTranscript={(text) => setMomentInput(prev => appendDictation(prev, text))}
                  label="Dictate a moment"
                />
                <button
                  onClick={() => addEntry('moments', momentInput)}
                  disabled={!momentInput.trim()}
                  className="px-4 bg-primary text-primary-foreground font-extrabold text-xs uppercase rounded-2xl disabled:opacity-40 transition-all flex items-center justify-center"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </section>

          {/* End of Day Dump Section */}
          <section className="p-6 md:p-8 bg-card border border-border rounded-sm shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-full bg-primary/10 text-primary">
                  <Moon className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider leading-none text-foreground">Brain Thoughts Dump</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Letting everything flow out, unedited and free</p>
                </div>
              </div>
            </div>

            <div className="relative">
              <textarea
                value={dumpInput}
                onChange={(e) => setDumpInput(e.target.value)}
                placeholder="Unload everything on your mind before rest... what was good, what was stressful?"
                className="w-full min-h-[140px] p-4 pb-16 rounded-2xl bg-background border border-border text-xs focus:ring-1 focus:ring-primary focus:outline-none placeholder:text-muted-foreground/45 resize-none shadow-inner"
              />
              <div className="absolute bottom-4 right-4 flex gap-2">
                <VoiceButton
                  variant="solid"
                  className="p-2.5 rounded-xl shadow-md"
                  onTranscript={(text) => setDumpInput(prev => appendDictation(prev, text))}
                  label="Voice-to-text scribe"
                />
                <button
                  onClick={() => addEntry('dump', dumpInput)}
                  disabled={!dumpInput.trim()}
                  className="p-2.5 bg-primary text-primary-foreground rounded-xl flex items-center justify-center disabled:opacity-40"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>

            {dumpEntries.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="flex justify-between items-center">
                  <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground/50">Recent dumps</p>
                  {dumpEntries.length > 3 && (
                    <button
                      onClick={() => setShowAllDumps(prev => !prev)}
                      type="button"
                      className="text-[9px] font-black uppercase tracking-wider text-primary hover:underline cursor-pointer"
                    >
                      {showAllDumps ? "See Less" : `View All (${dumpEntries.length})`}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(showAllDumps ? dumpEntries : dumpEntries.slice(0, 3)).map((entry) => (
                    <div 
                      key={entry.id} 
                      onClick={() => setSelectedDump(entry)}
                      className="p-4 rounded-2xl bg-card hover:bg-muted/10 border border-border text-xs text-muted-foreground flex justify-between items-start group shadow-sm cursor-pointer transition-all hover:border-primary/25 hover:shadow"
                    >
                      <div className="flex-1 space-y-1.5 pr-2">
                        <p className="line-clamp-2 leading-relaxed text-foreground/90 font-medium">{entry.content}</p>
                        <span className="text-[8px] font-bold text-muted-foreground/45 block">
                          {entry.createdAt ? format(new Date(entry.createdAt), "iii d MMM 'at' h:mm a") : "Thoughts"}
                        </span>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteEntry(entry.id);
                        }} 
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-rose-500 cursor-pointer"
                        title="Delete dump"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Password Vault Section */}
          <section className="p-6 md:p-8 bg-card border border-border rounded-sm shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-full bg-emerald-500/10 text-emerald-600">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider leading-none text-foreground">Password Vault</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Private logins kept in your encrypted journal</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-700 px-2 py-1 rounded">
                  {passwordEntries.length} saved
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (showPasswordForm) closePasswordForm();
                    else setShowPasswordForm(true);
                  }}
                  aria-expanded={showPasswordForm}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 text-primary transition-all text-[10px] font-black tracking-wider uppercase"
                >
                  {showPasswordForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  {showPasswordForm ? 'Close' : 'Add password'}
                </button>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-2xl bg-emerald-500/5 border border-emerald-500/15 p-3.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Saved with your journal password on this device. Passwords are not added to journal pages
                or included in AI context.
              </p>
            </div>

            {showPasswordForm && (
              <form
                onSubmit={addPassword}
                autoComplete="off"
                className="rounded-2xl border border-border bg-background/60 p-4 space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1.5 block">
                    <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Name</span>
                    <input
                      type="text"
                      value={passwordService}
                      onChange={(e) => setPasswordService(e.target.value)}
                      maxLength={80}
                      autoFocus
                      placeholder="e.g. Email, bank, Wi-Fi"
                      className="w-full p-3 rounded-xl bg-card border border-border text-xs focus:ring-1 focus:ring-primary focus:outline-none placeholder:text-muted-foreground/40"
                    />
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Username or email</span>
                    <input
                      type="text"
                      value={passwordUsername}
                      onChange={(e) => setPasswordUsername(e.target.value)}
                      maxLength={120}
                      autoComplete="off"
                      placeholder="Optional"
                      className="w-full p-3 rounded-xl bg-card border border-border text-xs focus:ring-1 focus:ring-primary focus:outline-none placeholder:text-muted-foreground/40"
                    />
                  </label>
                </div>

                <label className="space-y-1.5 block">
                  <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Password</span>
                  <div className="relative">
                    <input
                      type={showPasswordDraft ? 'text' : 'password'}
                      value={passwordValue}
                      onChange={(e) => setPasswordValue(e.target.value)}
                      maxLength={512}
                      autoComplete="off"
                      placeholder="Enter the password or private code"
                      className="w-full p-3 pr-11 rounded-xl bg-card border border-border text-xs font-mono focus:ring-1 focus:ring-primary focus:outline-none placeholder:text-muted-foreground/40"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswordDraft(prev => !prev)}
                      aria-label={showPasswordDraft ? 'Hide password being entered' : 'Show password being entered'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                    >
                      {showPasswordDraft ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Note</span>
                  <textarea
                    value={passwordNotes}
                    onChange={(e) => setPasswordNotes(e.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder="Optional recovery hint or account note"
                    className="w-full p-3 rounded-xl bg-card border border-border text-xs focus:ring-1 focus:ring-primary focus:outline-none placeholder:text-muted-foreground/40 resize-none"
                  />
                </label>

                {passwordError && (
                  <p role="alert" className="text-[10px] font-bold text-rose-500">{passwordError}</p>
                )}

                <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closePasswordForm}
                    className="px-4 py-2.5 rounded-xl border border-border text-[10px] font-black uppercase tracking-wider text-muted-foreground hover:bg-muted transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!passwordService.trim() || !passwordValue}
                    className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-wider disabled:opacity-40 transition-all"
                  >
                    Save password
                  </button>
                </div>
              </form>
            )}

            {passwordEntries.length === 0 ? (
              <div className="p-8 rounded-2xl border border-dashed border-border text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto">
                  <Lock className="w-4 h-4" />
                </div>
                <p className="text-xs font-bold text-foreground">No passwords saved yet</p>
                <p className="text-[10px] text-muted-foreground max-w-xs mx-auto leading-relaxed">
                  Add a login or private code and it will be stored in your encrypted vault.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {passwordEntries.map((entry) => {
                  const isVisible = Boolean(visiblePasswordIds[entry.id]);
                  const isCopied = copiedPasswordId === entry.id;
                  return (
                    <div key={entry.id} className="p-4 rounded-2xl border border-border bg-background/60 space-y-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 shrink-0">
                            <Lock className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-extrabold text-foreground truncate">{entry.service}</p>
                            {entry.username && (
                              <p className="text-[10px] text-muted-foreground truncate mt-0.5">{entry.username}</p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPasswordToDeleteId(entry.id)}
                          aria-label={`Delete password for ${entry.service}`}
                          className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-rose-500 hover:bg-rose-50 transition-all shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <div className="min-w-0 flex-1 rounded-xl border border-border bg-secondary/30 px-3 py-2.5">
                          <span className={cn(
                            "block font-mono text-xs break-all",
                            isVisible ? "text-foreground select-all" : "text-muted-foreground tracking-[0.18em]"
                          )}>
                            {isVisible ? entry.password : '••••••••••••'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => togglePasswordVisibility(entry.id)}
                          aria-label={`${isVisible ? 'Hide' : 'Show'} password for ${entry.service}`}
                          className="p-2.5 rounded-xl border border-border text-muted-foreground hover:text-primary hover:border-primary/30 transition-all shrink-0"
                        >
                          {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => copyPassword(entry)}
                          aria-label={`Copy password for ${entry.service}`}
                          className={cn(
                            "p-2.5 rounded-xl border transition-all shrink-0",
                            isCopied
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                              : "border-border text-muted-foreground hover:text-primary hover:border-primary/30"
                          )}
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>

                      {entry.notes && (
                        <p className="text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap border-t border-border/60 pt-2.5">
                          {entry.notes}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

        </div>

      {/* Cozy wood divider shelf */}
      <div className="border-t border-border/70 my-8 pt-8" />

      {/* Bookshelf section displaying scrolling covers */}
      <section className="space-y-5">
        <div className="flex items-center justify-between px-2">
          <div className="space-y-0.5">
            <h2 className="text-base font-bold tracking-tight text-foreground">My Bookshelf</h2>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">Tap a cover to open that journal on a new screen</p>
          </div>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 text-primary transition-all text-xs font-black tracking-wider uppercase"
          >
            <Plus className="w-3.5 h-3.5" /> New Journal
          </button>
        </div>

        {/* Scrollable Bookshelf Shelf */}
        <div className="relative">
          {/* Cozy wooden deck */}
          <div className="absolute left-0 right-0 bottom-7 h-1.5 bg-border/20  rounded-full" />
          
          <div className="flex gap-5 overflow-x-auto pb-4 pt-2 px-2 scrollbar-none snap-x select-none">
            {journals.map((journal) => {
              const isActive = journal.id === activeJournalId;
              const IconComp = iconMap[journal.coverIcon] || BookOpen;
              return (
                <div 
                  key={journal.id} 
                  className="flex-shrink-0 flex flex-col items-center group snap-center"
                >
                  <button
                    onClick={() => {
                      setActiveJournalId(journal.id);
                      setCurrentPageIdx(0);
                      setIsBookViewerOpen(true); // Tap cover immediately "opens like a normal book would on a new screen!"
                    }}
                    className={cn(
                      "w-24 h-32 rounded-2xl relative transition-all duration-300 transform shadow-md overflow-hidden",
                      isActive 
                        ? "ring-4 ring-primary ring-offset-4 scale-105 shadow-xl -translate-y-2" 
                        : " hover:shadow-lg "
                    )}
                    style={{ backgroundColor: journal.coverColor }}
                  >
                    {/* Binding lines */}
                    <div className="absolute inset-y-0 left-0 w-2.5 bg-black/15 border-r border-black/5 rounded-l-2xl z-10" />
                    <div className="absolute inset-y-0 left-2.5 w-[0.5px] bg-card/10 z-10" />
                    
                    {/* Gilt line decoration */}
                    <div className="absolute inset-2 border border-border rounded-lg pointer-events-none" />

                    {/* Emblem inside ring */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-10 h-10 rounded-full bg-card/10 flex items-center justify-center border border-border -[1px]">
                        <IconComp className="w-5 h-5 text-primary-foreground/95" />
                      </div>
                    </div>

                    <div className="absolute bottom-2 inset-x-3 flex justify-between items-center pointer-events-none">
                      <div className="h-0.5 w-4 bg-card/20 rounded-full" />
                      <div className="h-0.5 w-1 bg-card/20 rounded-full" />
                    </div>
                  </button>

                  <div className="flex items-center justify-center gap-1 mt-3 w-24">
                    <p className="text-[11px] font-extrabold text-foreground/85 tracking-tight truncate flex-1 text-center">
                      {journal.name}
                    </p>
                    <button
                      type="button"
                      onClick={() => setJournalToDeleteId(journal.id)}
                      aria-label={`Delete ${journal.name}`}
                      title={`Delete ${journal.name}`}
                      className="p-1 rounded-lg text-muted-foreground/45 hover:text-rose-500 hover:bg-rose-50 transition-all shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}

            {journals.length === 0 && (
              <div 
                onClick={() => setIsAddModalOpen(true)}
                className="flex-1 flex flex-col items-center justify-center p-6 border-2 border-dashed border-border rounded-3xl min-w-[200px] hover:border-primary/50 text-muted-foreground/50 hover:text-primary transition-all cursor-pointer h-32"
              >
                <Plus className="w-6 h-6 mb-2" />
                <span className="text-xs font-bold uppercase tracking-widest text-[10px]">Add Journal Cover</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* FULL-SCREEN REAL BOOK IMMERSIVE VIEWER (Opens on a new screen like a normal book!) */}
      <AnimatePresence>
        {isBookViewerOpen && activeJournal && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="fixed inset-0 z-[200] bg-[#0F1319] text-slate-100 flex flex-col justify-between overflow-y-auto p-4 md:p-8"
          >
            {/* Immersive Book Viewer Header */}
            <div className="flex justify-between items-center max-w-5xl w-full mx-auto border-b border-border pb-4 mb-4">
              <div className="flex items-center gap-3">
                <div 
                  className="w-7 h-9 rounded-md relative flex items-center justify-center text-primary-foreground font-black overflow-hidden shadow-md"
                  style={{ backgroundColor: activeJournal.coverColor }}
                >
                  <div className="absolute inset-y-0 left-0 w-1.5 bg-black/20" />
                  {React.createElement(iconMap[activeJournal.coverIcon] || BookMarked, { className: "w-3.5 h-3.5 text-primary-foreground" })}
                </div>
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest text-primary">Now Leafing Through</h3>
                  <h2 className="text-sm font-bold text-primary-foreground leading-none mt-0.5">{activeJournal.name}</h2>
                </div>
              </div>

              {/* Close & Preserve Book Button */}
              <button 
                onClick={() => setIsBookViewerOpen(false)}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-card/5 hover:bg-card/10 rounded-xl text-xs font-extrabold uppercase tracking-wide border border-border text-slate-300 hover:text-primary-foreground transition-all cursor-pointer"
              >
                <X className="w-4 h-4" /> Fold & Close Book
              </button>
            </div>

            {/* Immersive Physically-styled Closed/Opened Book Spine container */}
            <div className="flex-1 w-full max-w-5xl mx-auto flex flex-col justify-center my-1 xs:my-2 py-1 xs:py-2">
              
              {/* Mobile Tab Swapper */}
              <div className="md:hidden flex justify-center w-full mb-3 px-1">
                <div className="flex bg-slate-800/90 p-1 rounded-2xl w-full max-w-xs justify-between gap-1 border border-border shadow-lg">
                  <button
                    onClick={() => setMobileBookTab('read')}
                    className={cn(
                      "flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5",
                      mobileBookTab === 'read'
                        ? "bg-[#FAF7F2] text-slate-900 shadow-md"
                        : "text-slate-400 hover:text-primary-foreground"
                    )}
                  >
                    <BookOpen className="w-3.5 h-3.5" /> Read Page
                  </button>
                  <button
                    onClick={() => setMobileBookTab('write')}
                    className={cn(
                      "flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5",
                      mobileBookTab === 'write'
                        ? "bg-[#FAF7F2] text-slate-900 shadow-md"
                        : "text-slate-400 hover:text-primary-foreground"
                    )}
                  >
                    <PenTool className="w-3.5 h-3.5" /> Write Page
                  </button>
                </div>
              </div>

              <div className="w-full bg-[#FAF7F2]  border-4 border-amber-950/20 rounded-sm shadow-2xl relative grid grid-cols-1 md:grid-cols-2 overflow-hidden min-h-[420px] md:min-h-[550px]">
                
                {/* Book Seam spine bind down the center */}
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-8 bg-transparent border-x border-border z-20 pointer-events-none hidden md:block" />
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1px] bg-amber-900/15  z-20 pointer-events-none hidden md:block" />

                {/* LEFT BOOK PAGE: Chronicle Read Mode (Past Entries grouped on that selection date) */}
                <div className={cn(
                  "p-5 md:p-8 flex flex-col justify-between border-b md:border-b-0 md:border-r border-amber-950/10  relative bg-[#FCFBF7]  text-[#2D2A26] ",
                  mobileBookTab !== 'read' && 'hidden md:flex'
                )}>
                  
                  <div className="space-y-4">
                    {/* Header: Date Proudly Placed on Top of Page */}
                    <div className="text-center pb-3 border-b border-amber-950/10 ">
                      <p className="text-[10px] font-black tracking-widest uppercase text-amber-800/65 ">Logged Page Date</p>
                      
                      {/* USER REQUEST: "put the date on the top of the page" */}
                      <h2 className="text-base md:text-lg font-extrabold tracking-tight font-serif text-amber-950  mt-1">
                        {currentPage ? currentPage.date : format(new Date(), 'EEEE, MMMM d, yyyy')}
                      </h2>
                    </div>

                    {/* Quick Page Directory Selection to open old pages */}
                    {pages.length > 0 && (
                      <div className="bg-amber-950/5  p-2.5 rounded-2xl border border-amber-950/10  flex flex-col gap-1 shadow-inner">
                        <label className="text-[9px] font-black uppercase tracking-widest text-[#8A7355]">Search / Jump to Page:</label>
                        <div className="flex gap-1.5 overflow-x-auto pb-1.5 scrollbar-thin">
                          {pages.map((p, idx) => {
                            const isCurrent = idx === currentPageIdx;
                            return (
                              <button
                                key={p.date}
                                onClick={() => setCurrentPageIdx(idx)}
                                className={cn(
                                  "px-2.5 py-1.5 rounded-xl text-[10px] font-bold whitespace-nowrap transition-all border shrink-0 text-left cursor-pointer",
                                  isCurrent
                                    ? "bg-amber-950 text-primary-foreground border-amber-950   shadow-sm"
                                    : "bg-card hover:bg-amber-50/50 text-amber-900/80 border-amber-900/10   "
                                )}
                              >
                                {p.date.replace(/, \d{4}/, '')}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Past entries listing */}
                    <div className="max-h-[240px] md:max-h-[360px] overflow-y-auto pr-1 space-y-4 scrollbar-thin">
                      {!hasPages ? (
                        <div className="text-center py-12 md:py-16 space-y-4 text-neutral-500">
                          <Book className="w-12 h-12 stroke-[1.25] mx-auto text-amber-900/10" />
                          <div>
                            <p className="text-sm font-bold font-serif text-amber-950/40 ">The Pages are Blank</p>
                            <p className="text-[11px] max-w-[200px] mx-auto text-muted-foreground/60 leading-normal">
                              Type something onto the right Scribe page to save your very first item!
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {currentPage?.items.map((entry) => (
                            <div 
                              key={entry.id}
                              className={cn(
                                "p-4 rounded-xl border relative group transition-all",
                                entry.type === 'dreams'
                                  ? "bg-primary/5  border-primary/20 text-primary "
                                  : "bg-amber-50/20  border-amber-900/5  text-neutral-850 "
                              )}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1.5">
                                  {renderIconForType(entry.type || '')}
                                  <span className="text-[9px] font-black uppercase text-muted-foreground tracking-wider">
                                    {renderBadgeTitleForType(entry.type || '')}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[8px] font-extrabold text-muted-foreground/55 uppercase">
                                    {entry.createdAt ? format(new Date(entry.createdAt), 'h:mm a') : 'Now'}
                                  </span>
                                  <button
                                    onClick={() => deleteEntry(entry.id)}
                                    className="p-1 rounded text-red-500 bg-red-100/10 :bg-red-950/30 hover:bg-red-50"
                                    title="Delete entry"
                                  >
                                    <Trash2 className="w-3" />
                                  </button>
                                </div>
                              </div>

                              {entry.prompt && (
                                <p className="text-[10px] font-bold text-amber-800  bg-amber-900/5  px-2 py-1 rounded-md mb-2">
                                  Q: {entry.prompt}
                                </p>
                              )}

                              <p className="text-xs font-serif leading-relaxed whitespace-pre-wrap">
                                {entry.content}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Flippers Page Turners on book bottom left */}
                  <div className="flex justify-between items-center pt-4 border-t border-amber-950/10  mt-2">
                    <button
                      onClick={goNextPage}
                      disabled={currentPageIdx >= pages.length - 1}
                      className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-900/60  hover:text-amber-950 hover:bg-amber-100/40 p-2 rounded-xl disabled:opacity-25 transition-all"
                    >
                      <ChevronLeft className="w-4 h-4" /> Older Page
                    </button>
                    <span className="text-[10px] font-mono tracking-widest text-[#8A7355]">
                      {hasPages ? `PAGE ${currentPageIdx+1} / ${pages.length}` : '0 / 0'}
                    </span>
                  </div>
                </div>

                {/* RIGHT BOOK PAGE: Inscriber Flow (Scribe items into this book dynamically) */}
                <div className={cn(
                  "p-5 md:p-8 flex flex-col justify-between bg-[#FCFBF7]  text-[#2D2A26] ",
                  mobileBookTab !== 'write' && 'hidden md:flex'
                )}>
                  <div className="space-y-4">
                    
                    {/* Right page head */}
                    <div className="text-center pb-3 border-b border-amber-950/10 ">
                      <p className="text-[10px] font-black tracking-widest uppercase text-amber-800/65 ">Right Leaf</p>
                      <h2 className="text-base font-extrabold tracking-tight font-serif text-amber-950  mt-1 flex items-center justify-center gap-1.5">
                        <PenTool className="w-4 h-4 text-amber-800/60" /> Inscribe Entry
                      </h2>
                    </div>

                    {/* Scribing Canvas Fields */}
                    <div className="space-y-3 pt-1">
                      <p className="text-[10px] text-muted-foreground/45 italic leading-tight">Pour your thoughts, diary notes, or reflections freely...</p>

                      <div className="relative">
                        <textarea
                          value={bookEditorInput}
                          onChange={(e) => {
                            setBookEditorInput(e.target.value);
                            setBookWriteType('note');
                          }}
                          placeholder="Write about your day, your feelings, or anything on your mind..."
                          className="w-full min-h-[140px] md:min-h-[260px] h-[160px] md:h-auto p-4 pb-12 bg-card/30  border border-amber-900/10  text-xs text-foreground focus:ring-1 focus:ring-amber-900 :ring-primary focus:outline-none placeholder:text-muted-foreground/40 resize-none font-serif leading-relaxed rounded-2xl"
                        />
                        <VoiceButton
                          size="sm"
                          className="absolute bottom-3 right-3 bg-background/60 "
                          onTranscript={(text) => {
                            setBookWriteType('note');
                            setBookEditorInput(prev => appendDictation(prev, text));
                          }}
                          label="Dictate your entry"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Submission and pagination controls on book bottom right */}
                  <div className="space-y-4 shadow-none pt-2 mt-4 border-t border-amber-950/10 ">
                    <button
                      onClick={addEntryFromBookEditor}
                      disabled={!bookEditorInput.trim()}
                      className="w-full py-3.5 bg-amber-950  text-primary-foreground rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-40 transition-all flex items-center justify-center gap-2 shadow"
                    >
                      <Plus className="w-4 h-4" /> Inscribe to Left Page
                    </button>

                    <div className="flex justify-between items-center text-xs">
                      <button
                        onClick={goPrevPage}
                        disabled={currentPageIdx === 0}
                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-900/60  hover:text-amber-950 hover:bg-amber-100/40 p-2 rounded-xl disabled:opacity-25 transition-all"
                      >
                        Newer Page <ChevronRight className="w-4 h-4" />
                      </button>
                      <span className="text-[9px] font-black uppercase text-amber-900/40 ">
                        INK & SEAL
                      </span>
                    </div>
                  </div>
                </div>

              </div>
            </div>

          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Journal Modal Popup overlay */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-card border border-border rounded-sm w-full max-w-2xl overflow-y-auto max-h-[90vh] shadow-2xl flex flex-col md:flex-row scrollbar-thin"
            >
              {/* Left Side: Live Book Cover Canvas Preview */}
              <div className="bg-secondary/40 p-8 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-border/60 w-full md:w-5/12 space-y-4">
                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Cover Preview</span>
                
                <div 
                  className="w-36 h-48 rounded-sm relative shadow-2xl transition-all duration-300 transform overflow-hidden flex flex-col justify-between"
                  style={{ backgroundColor: newJournalColor }}
                >
                  {/* Spine Fold */}
                  <div className="absolute inset-y-0 left-0 w-3.5 bg-black/15 border-r border-black/5 rounded-l-[1.25rem]" />
                  <div className="absolute inset-y-0 left-3.5 w-[0.5px] bg-card/10" />
                  
                  {/* Outer margin lines */}
                  <div className="absolute inset-2 border border-border rounded-lg pointer-events-none" />

                  {/* Icon plate */}
                  <div className="flex-1 flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-card/10 border border-border -[1px] flex items-center justify-center shadow-inner">
                      {React.createElement(iconMap[newJournalIcon] || BookOpen, { className: "w-6 h-6 text-primary-foreground" })}
                    </div>
                  </div>

                  {/* Gold or silver branding title plate */}
                  <div className="p-3 bg-black/10 -[2px] border-t border-border text-center">
                    <p className="text-[10px] font-bold text-primary-foreground/95 tracking-tight truncate px-1">
                      {newJournalName.trim() || 'My Reflections'}
                    </p>
                  </div>
                </div>

                <div className="text-center">
                  <span className="text-[10px] font-medium text-muted-foreground/60">Choose cover style style</span>
                </div>
              </div>

              {/* Right Side: Options Settings Panel */}
              <div className="p-8 flex-1 space-y-6">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-black tracking-tight text-foreground uppercase">Create Journal</h3>
                  <button 
                    onClick={() => setIsAddModalOpen(false)}
                    className="p-2 hover:bg-muted rounded-full transition-all text-muted-foreground/60 hover:text-foreground"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Name Input */}
                <div className="space-y-2">
                  <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Title / Purpose</label>
                  <input
                    type="text"
                    autoFocus
                    value={newJournalName}
                    onChange={(e) => setNewJournalName(e.target.value)}
                    placeholder="e.g., Morning Reflections"
                    maxLength={26}
                    className="w-full p-4 rounded-2xl bg-background border border-border text-sm font-bold tracking-tight focus:ring-2 focus:ring-primary focus:outline-none placeholder:text-muted-foreground/30 shadow-inner"
                  />
                </div>

                {/* Color Palette Choice */}
                <div className="space-y-2.5">
                  <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Select Color Art ({COVER_COLORS.find(c => c.value === newJournalColor)?.name})</label>
                  <div className="grid grid-cols-6 gap-2">
                    {COVER_COLORS.map((col) => {
                      const isSelected = col.value === newJournalColor;
                      return (
                        <button
                          key={col.id}
                          type="button"
                          onClick={() => setNewJournalColor(col.value)}
                          className={cn(
                            "aspect-square rounded-full flex items-center justify-center transition-all border border-black/10 select-none",
                            isSelected ? "ring-2 ring-primary ring-offset-2 scale-105" : "opacity-80 hover:opacity-100"
                          )}
                          style={{ backgroundColor: col.value }}
                          title={col.name}
                        >
                          {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-card shadow-sm" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Symbol Plate Selection */}
                <div className="space-y-2.5">
                  <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Embossed Symbol</label>
                  <div className="grid grid-cols-4 gap-2">
                    {COVER_ICONS.map((ico) => {
                      const isSelected = ico.id === newJournalIcon;
                      const IconField = ico.icon;
                      return (
                        <button
                          key={ico.id}
                          type="button"
                          onClick={() => setNewJournalIcon(ico.id)}
                          className={cn(
                            "p-3 rounded-xl border flex flex-col items-center justify-center transition-all gap-1 text-xs font-semibold",
                            isSelected 
                              ? "bg-primary border-primary text-primary-foreground shadow-sm scale-[1.03]" 
                              : "bg-background border-border/80 text-muted-foreground/60 hover:text-primary hover:border-primary/20"
                          )}
                        >
                          <IconField className="w-4 h-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Create Trigger */}
                <button
                  onClick={addJournal}
                  disabled={!newJournalName.trim()}
                  className="w-full py-4 mt-2 rounded-2xl bg-primary text-primary-foreground font-black text-xs uppercase tracking-widest transition-all disabled:opacity-40 shadow-md shadow-primary/10"
                >
                  Embark on Writing
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Div-based safe delete popup */}
      <AnimatePresence>
        {journalToDeleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border rounded-sm p-6 max-w-sm w-full shadow-2xl text-center space-y-5"
            >
              <div className="w-12 h-12 bg-rose-100  text-rose-500 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              
              <div className="space-y-1.5">
                <h3 className="text-base font-bold text-foreground">Delete this Journal?</h3>
                <p className="text-xs text-muted-foreground leading-normal">
                  You are about to delete <span className="font-extrabold text-[#2D2A26] ">"{journals.find(j => j.id === journalToDeleteId)?.name}"</span>. This will permanently remove the journal and all entries logged inside. This action cannot be undone.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setJournalToDeleteId(null)}
                  className="flex-1 py-3 rounded-xl border border-border text-xs font-black uppercase tracking-wider text-muted-foreground hover:bg-muted transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => journalToDeleteId && deleteJournal(journalToDeleteId)}
                  className="flex-1 py-3 bg-rose-500 text-primary-foreground rounded-xl text-xs font-black uppercase tracking-wider hover:bg-rose-600 transition-all shadow-md shadow-rose-250"
                >
                  Confirm Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Password delete confirmation */}
      <AnimatePresence>
        {passwordToDeleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border rounded-sm p-6 max-w-sm w-full shadow-2xl text-center space-y-5"
            >
              <div className="w-12 h-12 bg-rose-100 text-rose-500 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-base font-bold text-foreground">Delete this password?</h3>
                <p className="text-xs text-muted-foreground leading-normal">
                  This removes <span className="font-extrabold text-foreground">"{passwordEntries.find(entry => entry.id === passwordToDeleteId)?.service || 'this login'}"</span> from your encrypted vault. This action cannot be undone.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setPasswordToDeleteId(null)}
                  className="flex-1 py-3 rounded-xl border border-border text-xs font-black uppercase tracking-wider text-muted-foreground hover:bg-muted transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => passwordToDeleteId && deletePassword(passwordToDeleteId)}
                  className="flex-1 py-3 bg-rose-500 text-primary-foreground rounded-xl text-xs font-black uppercase tracking-wider hover:bg-rose-600 transition-all shadow-md"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Brain Dump Immersive Viewer Modal */}
      <AnimatePresence>
        {selectedDump && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-card border border-border rounded-sm max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              {/* Header */}
              <div className="p-6 border-b border-border/60 flex justify-between items-center bg-secondary/10">
                <div className="flex items-center gap-2.5 text-primary ">
                  <Moon className="w-4 h-4" />
                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Brain Dump Scribe</h3>
                    <p className="text-xs font-extrabold text-[#2D2A26]  mt-0.5">
                      {selectedDump.createdAt ? format(new Date(selectedDump.createdAt), "iiii, MMMM d, yyyy 'at' h:mm a") : "Today"}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedDump(null)}
                  className="p-1.5 hover:bg-muted rounded-full transition-all text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Content area */}
              <div className="p-6 overflow-y-auto flex-1 font-serif text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap select-text selection:bg-primary/25 border-b border-border/40">
                {selectedDump.content}
              </div>

              {/* Footer action */}
              <div className="p-4 bg-secondary/5 flex gap-2 justify-end">
                <button 
                  onClick={() => {
                    deleteEntry(selectedDump.id);
                    setSelectedDump(null);
                  }}
                  className="px-4 py-2 text-[10px] font-black uppercase tracking-wider text-rose-500 hover:bg-rose-50 :bg-rose-950/20 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete Dump
                </button>
                <button 
                  onClick={() => setSelectedDump(null)}
                  className="px-5 py-2.5 bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default Journal;
