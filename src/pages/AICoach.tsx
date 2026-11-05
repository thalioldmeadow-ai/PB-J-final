import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Lightbulb, User, Bot, ChevronLeft, Loader2, ArrowUpRight, Undo2, ListTodo, Utensils, Dumbbell, Wallet, BookOpen, Paperclip, Play, X } from '../components/icons';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { cn, compressImage } from '../lib/utils';
import VoiceButton from '../components/VoiceButton';
import AiCreditIndicator from '../components/AiCreditIndicator';
import { appendDictation } from '../hooks/useVoiceInput';
import { applyCaptures, FiledItem, planCaptures, summarizeFiled, undoFiled } from '../lib/capture';
import { useAuth } from '../components/AuthProvider';
import { useTheme } from '../components/ThemeProvider';
import { storage } from '../lib/storage';
import { AiRequestError, askAi, askAiStream, fetchAiStatus, reportAiReply } from '../lib/ai';
import {
  addMemory,
  autoMemoryCandidate,
  loadMemory,
  memoryCommand,
  selectRelevantMemory,
} from '../lib/aiMemory';
import { buildConversationWindow, windowStats } from '../lib/aiHistory';
import { buildRelevantContext } from '../lib/aiContext';
import {
  addMessage,
  createConversation,
  deleteConversation,
  ensureConversations,
  listConversations,
  loadMessages,
  renameConversation,
  titleFromMessage,
  touchConversation,
} from '../lib/aiConversations';
import { AiChatAttachment, AiConversation, AiMemoryFact, AiStatus, AiStoredMessage } from '../types';

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  createdAt?: string;
  filed?: FiledItem[];
  removed?: string[];
  meta?: { provider: string; model: string };
  attachments?: AiChatAttachment[];
}

const WELCOME_ID = 'welcome';

const FILED_ICON: Record<FiledItem['kind'], typeof ListTodo> = {
  task: ListTodo,
  meal: Utensils,
  workout: Dumbbell,
  spending: Wallet,
  journal: BookOpen,
};

const CAPTURE_EXAMPLES = ['Dentist tomorrow at 3pm', 'Spent $8.90 on bubble tea', 'Yoga 30 min'];

const newId = () => Math.random().toString(36).slice(2, 11) + Math.random().toString(36).slice(2, 6);
const now = () => new Date().toISOString();

const MAX_ATTACHMENTS = 4;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT = 6_000;
const MAX_TOTAL_PREVIEW_CHARS = 1_700_000;

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const readDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });

const isTextFile = (file: File): boolean =>
  file.type.startsWith('text/') ||
  file.type === 'application/json' ||
  /\.(txt|md|markdown|csv|json|xml|ya?ml|html?|css|js|ts|tsx|jsx|log)$/i.test(file.name);

/** A video cannot be sent to a chat model, so keep its first usable frame. */
const videoStill = (file: File): Promise<string | undefined> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let timer: number | undefined;
    let settled = false;

    const finish = (value?: string) => {
      if (settled) return;
      settled = true;
      if (timer) window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };

    timer = window.setTimeout(() => finish(), 6_000);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onerror = () => finish();
    const drawStill = () => {
      try {
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 360;
        const scale = Math.min(1, 1200 / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d');
        if (!context) return finish();
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        finish();
      }
    };
    video.onloadeddata = drawStill;
    video.onseeked = drawStill;
    video.onloadedmetadata = () => {
      try {
        video.currentTime = Math.min(0.1, video.duration || 0.1);
      } catch {
        drawStill();
      }
    };
    video.src = url;
    video.load();
  });

const attachmentFromFile = async (file: File): Promise<AiChatAttachment> => {
  const kind: AiChatAttachment['kind'] = file.type.startsWith('image/')
    ? 'image'
    : file.type.startsWith('video/')
      ? 'video'
      : 'file';
  const attachment: AiChatAttachment = {
    id: newId(),
    name: file.name || 'Attachment',
    mime: file.type || 'application/octet-stream',
    size: file.size,
    kind,
  };

  if (kind === 'image') {
    try {
      const raw = await readDataUrl(file);
      attachment.preview = await compressImage(raw, 1200, 1200, 0.68);
    } catch {
      // The file can still be listed even if this browser cannot preview it.
    }
  } else if (kind === 'video') {
    attachment.preview = await videoStill(file);
  } else if (isTextFile(file) && file.size <= 2 * 1024 * 1024) {
    try {
      attachment.text = (await file.text()).slice(0, MAX_ATTACHMENT_TEXT);
    } catch {
      // Leave the file listed without text when it cannot be read.
    }
  }

  return attachment;
};

const WELCOME: Message = {
  id: WELCOME_ID,
  role: 'model',
  text: "Hello. Ask me anything, or tell me something to file and I'll put it in the right place. I can also help you plan the day, understand your own entries, or think through a goal.",
};

// Gentle replies built into the app, used when the assistant is off,
// unconfigured or unreachable, so the screen is never a dead end.
const COACH_REPLIES: { match: RegExp; reply: string }[] = [
  {
    match: /overwhelm|too much|can'?t cope|anxious|anxiety|panic|stress/i,
    reply: "That sounds like a lot to carry at once, thank you for telling me.\n\n- Pick **one** thing and shrink it until it feels almost too easy.\n- Two minutes of breathing or a glass of water still counts as a step.\n- Brain-dump everything into one message and I'll file it where it belongs.",
  },
  {
    match: /tired|exhaust|no energy|burn(ed|t)? out|sleep/i,
    reply: "Rest isn't a reward you have to earn.\n\n- Lower the bar on purpose today: choose the one thing that actually matters.\n- Try a 10-minute reset, lying down, eyes closed, no screens.\n- Tell me what's rattling around and I'll get it out of your head.",
  },
  {
    match: /sad|down|low|lonely|blue|crying|cry|hopeless/i,
    reply: "I hear you, and I'm glad you said it out loud.\n\n- You don't have to fix the feeling to get through the day.\n- One small comfort, warmth, water, a familiar song, is enough for now.\n- If it's been heavy for a while, talking to someone you trust is worth it.",
  },
  {
    match: /angry|frustrat|annoy|irritat|furious|mad\b/i,
    reply: "That frustration is real, and it makes sense.\n\n- Name the one thing that set it off, writing it down usually shrinks it.\n- Move the energy out: a short walk, shaking out your hands, a stretch.\n- Then we can decide what actually needs a next step.",
  },
  {
    match: /good|great|happy|proud|excited|better|managed|win\b/i,
    reply: "That's lovely to hear, let's keep it.\n\n- What made it good? One line is enough.\n- Want it saved? Type `note: …` and I'll file it in your Journal.",
  },
  {
    match: /plan|organi[sz]e|start|stuck|procrastinat|motivat|focus|distract/i,
    reply: "Let's make it smaller rather than harder.\n\n- Pick one task, set a 10-minute timer, and stop when it rings.\n- Decide the very next physical action (open the doc, fill the kettle).\n- Say it here like `Dentist tomorrow at 3pm` and I'll put it on the right day.",
  },
];

const coachReply = (text: string) =>
  COACH_REPLIES.find(reply => reply.match.test(text))?.reply ||
  "I'm here. This box also files things for you, everything below happens on this device:\n\n" +
    '- `Dentist tomorrow at 3pm` → Tasks\n' +
    '- `Spent $8.90 on bubble tea` → Budget\n' +
    '- `Yoga 30 min` → Workouts\n' +
    '- `lunch: chicken salad` → Meals\n' +
    '- `note: …` → Journal\n\n' +
    'Or ask me something general and I will do my best to help.';

const toMessage = (row: AiStoredMessage): Message => ({
  id: row.id,
  role: row.role === 'user' ? 'user' : 'model',
  text: row.text,
  createdAt: row.createdAt,
  meta: row.provider ? { provider: row.provider, model: row.model || '' } : undefined,
  attachments: row.attachments,
});

const whenLabel = (iso: string): string => {
  const date = new Date(iso);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const AICoach: React.FC = () => {
  const { user } = useAuth();
  const { settings } = useTheme();
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeId, setActiveId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [userMessage, setUserMessage] = useState('');
  const [attachments, setAttachments] = useState<AiChatAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [facts, setFacts] = useState<AiMemoryFact[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // What the last request actually contained, shown so the screen is honest.
  const [sentNote, setSentNote] = useState<string | null>(null);
  // Reporting sends a reason category only; the reply stays on this device.
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const aiOn = settings.aiEnabled !== false && (status ? status.enabled : true);
  const activeProvider = status?.defaultModel?.split(':')[0];
  const providerLabel =
    status?.providers.find(provider => provider.id === activeProvider)?.label || 'AI';
  const activeConversation = conversations.find(conversation => conversation.id === activeId);

  // Conversations and messages are decrypted from this account's vault only.
  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      try {
        const restored = await ensureConversations();
        if (cancelled) return;
        const sorted = [...restored].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        const active = sorted[0];
        setConversations(sorted);
        setActiveId(active.id);

        const [stored, memory, liveStatus] = await Promise.all([
          loadMessages(active.id),
          loadMemory(),
          fetchAiStatus(user?.uid),
        ]);
        if (cancelled) return;
        setMessages(stored.map(toMessage));
        setFacts(memory);
        setStatus(liveStatus);
      } catch (error) {
        if (!cancelled) setNotice('Conversations could not be opened on this device.');
        console.error('Could not open conversations:', error);
      } finally {
        if (!cancelled) setBooting(false);
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [userMessage]);

  const refreshConversations = async () => {
    const list = await listConversations();
    setConversations(list);
    return list;
  };

  const openConversation = async (id: string) => {
    if (booting) return;
    setNotice(null);
    setActiveId(id);
    setAttachments([]);
    setAttachmentError(null);
    setHistoryOpen(false);
    setConfirmDeleteId(null);
    setRenamingId(null);
    try {
      const stored = await loadMessages(id);
      setMessages(stored.map(toMessage));
    } catch {
      setMessages([]);
      setNotice('That conversation could not be opened.');
    }
  };

  const startNewChat = async () => {
    // Do not pile up empty threads: an untouched conversation is already a new chat.
    if (activeConversation && activeConversation.messageCount === 0) {
      setMessages([]);
      setUserMessage('');
      setAttachments([]);
      setAttachmentError(null);
      setNotice(null);
      setHistoryOpen(false);
      return;
    }

    const conversation = await createConversation();
    await refreshConversations();
    setActiveId(conversation.id);
    setMessages([]);
    setNotice(null);
    setHistoryOpen(false);
    setUserMessage('');
    setAttachments([]);
    setAttachmentError(null);
  };

  const removeConversation = async (id: string) => {
    await deleteConversation(id);
    const remaining = await refreshConversations();

    if (remaining.length === 0) {
      const fresh = await createConversation();
      await refreshConversations();
      setActiveId(fresh.id);
      setMessages([]);
    } else if (id === activeId) {
      const next = remaining[0];
      setActiveId(next.id);
      setMessages((await loadMessages(next.id)).map(toMessage));
    }

    setConfirmDeleteId(null);
  };

  const saveRename = async (id: string) => {
    await renameConversation(id, renameValue);
    setRenamingId(null);
    setRenameValue('');
    await refreshConversations();
  };

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setAttachmentError(null);

    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setAttachmentError(`You can attach up to ${MAX_ATTACHMENTS} files to one message.`);
      return;
    }

    const chosen = files.slice(0, room);
    const sized = chosen.filter(file => file.size <= MAX_FILE_BYTES);
    if (sized.length < chosen.length) {
      setAttachmentError('One file was over 20 MB and was not added.');
    } else if (files.length > room) {
      setAttachmentError(`Only ${room} more attachment${room === 1 ? '' : 's'} could be added.`);
    }

    setAttaching(true);
    try {
      const prepared: AiChatAttachment[] = [];
      for (const file of sized) {
        try {
          prepared.push(await attachmentFromFile(file));
        } catch {
          setAttachmentError(`Could not read ${file.name}.`);
        }
      }

      let total = attachments.reduce((sum, item) => sum + (item.preview?.length || 0), 0);
      const kept: AiChatAttachment[] = [];
      let skippedPreview = false;
      for (const item of prepared) {
        const previewChars = item.preview?.length || 0;
        if (previewChars > 0 && total + previewChars > MAX_TOTAL_PREVIEW_CHARS) {
          skippedPreview = true;
          continue;
        }
        kept.push(item);
        total += previewChars;
      }

      setAttachments(prev => [...prev, ...kept].slice(0, MAX_ATTACHMENTS));
      if (skippedPreview) {
        setAttachmentError('One attachment was too large to keep a preview. Try a smaller file.');
      }
    } finally {
      setAttaching(false);
    }
  };

  const append = (message: Omit<Message, 'id'>) =>
    setMessages(prev => [...prev, { ...message, id: newId() }]);

  const handleUndo = async (messageIndex: number, item: FiledItem) => {
    try {
      await undoFiled(item);
      setMessages(prev =>
        prev.map((message, index) =>
          index === messageIndex ? { ...message, removed: [...(message.removed || []), item.id] } : message
        )
      );
    } catch (error) {
      console.error('Error undoing capture:', error);
    }
  };

  const persist = async (
    role: 'user' | 'assistant',
    text: string,
    meta?: { provider: string; model: string },
    files?: AiChatAttachment[],
  ) => {
    if (!activeId) return;
    await addMessage({
      conversationId: activeId,
      role,
      text,
      createdAt: now(),
      provider: meta?.provider,
      model: meta?.model,
      attachments: files,
    });
    await touchConversation(activeId, { updatedAt: now() });
  };

  // Counts and the ordering are recomputed from storage, never guessed from
  // the previous render, so the history list stays accurate.
  const syncConversations = async () => {
    const list = await ensureConversations();
    setConversations(list);
  };

  const handleSend = async () => {
    const typed = userMessage.trim();
    const currentAttachments = attachments;
    if ((!typed && currentAttachments.length === 0) || isLoading || booting) return;

    const currentInput = typed || 'Please look at the attached files.';
    setUserMessage('');
    setAttachments([]);
    setAttachmentError(null);
    setNotice(null);

    const isFirstUserMessage = messages.length === 0;
    append({
      role: 'user',
      text: currentInput,
      createdAt: now(),
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
    });
    await persist('user', currentInput, undefined, currentAttachments);

    if (isFirstUserMessage) {
      await renameConversation(activeId, titleFromMessage(typed || currentAttachments[0]?.name || currentInput));
      await refreshConversations();
    }

    setIsLoading(true);

    try {
      const memoryOn = settings.aiMemoryEnabled !== false;

      // Captures and "remember" commands are text-only shortcuts. A message
      // with an attachment goes to the assistant so the file is not ignored.
      if (currentAttachments.length === 0) {
      // "remember ..." is a durable note, kept encrypted on this device. It is
      // refused when memory has been switched off, rather than saved quietly.
      const fact = memoryCommand(currentInput);
      if (fact) {
        if (!memoryOn) {
          const reply =
            'Memory is switched off in Settings, so I have not saved that. You can turn it on there and ask again.';
          append({ role: 'model', text: reply, createdAt: now() });
          await persist('assistant', reply);
          return;
        }
        const saved = await addMemory(fact.text, fact.kind, 'explicit');
        setFacts(await loadMemory());
        const reply = saved
          ? `Noted, I'll keep that in mind: "${saved.text}". It is saved with your account on this device, and you can edit or remove it in Settings.`
          : `That is already in my notes for you: "${fact.text}".`;
        append({ role: 'model', text: reply, createdAt: now() });
        await persist('assistant', reply);
        return;
      }

      // Anything that looks like a task, meal, workout, expense or note is filed
      // straight into the matching part of the app, with no service involved.
      const plans = planCaptures(currentInput, user?.uid || 'guest');
      if (plans.length > 0) {
        try {
          const filed = await applyCaptures(plans);
          const summary = summarizeFiled(filed);
          append({ role: 'model', text: summary, filed, createdAt: now() });
          await persist('assistant', summary);
        } catch (error) {
          console.error('Error filing capture:', error);
          append({ role: 'model', text: "I couldn't file that, mind trying again?", createdAt: now() });
        }
        return;
      }
      }

      if (!aiOn) {
        const reply = coachReply(currentInput);
        append({ role: 'model', text: reply, createdAt: now() });
        await persist('assistant', reply);
        setNotice(
          (settings.aiEnabled === false
            ? 'The AI assistant is off in Settings, so this reply came from the built-in coach.'
            : 'No AI provider key is set on this server, so this reply came from the built-in coach.') +
            (currentAttachments.length > 0 ? ' The built-in coach cannot read attachments.' : '')
        );
        return;
      }

      // Short-term context: recent turns, the older turns that share words with
      // this question, and a short app-built summary of what was left out.
      const stored = messages
        .filter(message => message.id !== WELCOME_ID)
        .map(message => ({
          id: message.id,
          role: (message.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          text: message.text,
        }));
      const window = buildConversationWindow(stored, currentInput);
      const memoryFacts = memoryOn ? selectRelevantMemory(await loadMemory(), currentInput) : [];

      const payload = {
        message: currentInput,
        history: window.turns,
        summary: window.summary,
        memory: memoryFacts.map(entry => entry.text),
        // Only the slices this question mentions, from this account's vault.
        context: await buildRelevantContext(currentInput),
        ageBand: settings.aiAgeBand || 'adult',
        name: user?.displayName,
        provider: settings.aiProvider || 'auto',
        user: user?.uid,
        attachments: currentAttachments,
      } as const;

      setSentNote(
        [
          `${windowStats(window).turns} earlier messages`,
          window.omitted > 0 ? `${window.omitted} older ones summarised` : '',
          memoryFacts.length > 0 ? `${memoryFacts.length} saved notes` : '',
          currentAttachments.length > 0
            ? `${currentAttachments.length} attachment${currentAttachments.length === 1 ? '' : 's'}`
            : '',
        ]
          .filter(Boolean)
          .join(' · ') || null
      );

      const crisisNote = (crisis: boolean) =>
        crisis ? '\n\nIf you are in immediate danger, contact your local emergency number now.' : '';

      const draftId = newId();
      let streamed = '';
      setMessages(prev => [...prev, { id: draftId, role: 'model', text: '', createdAt: now() }]);

      const finishDraft = (updates: Partial<Message>) =>
        setMessages(prev => prev.map(message => (message.id === draftId ? { ...message, ...updates } : message)));

      let finalText = '';
      let finalMeta: { provider: string; model: string } | undefined;

      try {
        const result = await askAiStream(payload, chunk => {
          streamed += chunk;
          finishDraft({ text: streamed });
        });
        finalText = result.reply + crisisNote(result.safety.crisis);
        finalMeta = { provider: result.provider, model: result.model };
      } catch (streamError) {
        setMessages(prev => prev.filter(message => message.id !== draftId));
        if (!streamed) {
          const result = await askAi(payload);
          finalText = result.reply + crisisNote(result.safety.crisis);
          finalMeta = { provider: result.provider, model: result.model };
          append({ role: 'model', text: finalText, createdAt: now(), meta: finalMeta });
        } else {
          throw streamError;
        }
      }

      if (finalMeta) {
        finishDraft({ text: finalText, meta: finalMeta });
        await persist('assistant', finalText, finalMeta);

        // Optional convenience only: one durable self-statement per message,
        // never the whole conversation, and never when memory is off.
        if (memoryOn && settings.aiMemoryAutoSave) {
          const candidate = autoMemoryCandidate(currentInput);
          if (candidate) {
            const saved = await addMemory(candidate.text, candidate.kind, 'auto');
            if (saved) setFacts(await loadMemory());
          }
        }
      }
    } catch (error) {
      const message =
        error instanceof AiRequestError ? error.message : 'The assistant could not answer just now.';
      const reply = coachReply(currentInput);
      append({ role: 'model', text: reply, createdAt: now() });
      await persist('assistant', reply);
      setNotice(
        `${message} This reply came from the built-in coach.${
          currentAttachments.length > 0 ? ' It cannot read attachments.' : ''
        }`
      );
    } finally {
      await syncConversations();
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-180px)] space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3 mb-1">
        <Link to="/" className="p-2 rounded-full hover:bg-muted transition-colors" aria-label="Back to Today">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="p-2 rounded-full bg-primary/20 text-primary">
            <Lightbulb className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight">AI Assistant</h2>
            <p className="text-[10px] text-muted-foreground truncate">
              {aiOn ? `On · ${providerLabel}` : 'Built-in replies'} · {facts.length} remembered
              {activeConversation ? ` · ${activeConversation.messageCount} messages` : ''}
            </p>
            <AiCreditIndicator user={user?.uid} className="mt-1" />
          </div>
        </div>
        <button
          onClick={() => {
            setHistoryOpen(open => !open);
            setConfirmDeleteId(null);
          }}
          aria-expanded={historyOpen}
          className="shrink-0 px-3 py-1.5 rounded-full border border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
        >
          History
        </button>
        <button
          onClick={startNewChat}
          className="shrink-0 px-3 py-1.5 rounded-full border border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
        >
          New chat
        </button>
      </div>

      {historyOpen && (
        <div className="rounded-2xl border border-border bg-card p-2 space-y-1 max-h-56 overflow-y-auto scrollbar-hide">
          {conversations.length === 0 && (
            <p className="text-[11px] text-muted-foreground px-2 py-1">No conversations yet.</p>
          )}
          {conversations
            .filter(conversation => conversation.messageCount > 0 || conversation.id === activeId)
            .map(conversation => (
            <div
              key={conversation.id}
              className={cn(
                'rounded-xl px-2.5 py-2 transition-colors',
                conversation.id === activeId ? 'bg-primary/10' : 'hover:bg-muted/50'
              )}
            >
              {renamingId === conversation.id ? (
                <div className="flex items-center gap-2">
                  <input
                    value={renameValue}
                    onChange={event => setRenameValue(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') void saveRename(conversation.id);
                      if (event.key === 'Escape') setRenamingId(null);
                    }}
                    aria-label="Conversation title"
                    autoFocus
                    className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-background border border-border text-[11px]"
                  />
                  <button
                    onClick={() => void saveRename(conversation.id)}
                    className="text-[9px] font-bold uppercase tracking-widest text-primary"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setRenamingId(null)}
                    className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void openConversation(conversation.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="text-[11px] font-semibold truncate">{conversation.title}</p>
                    <p className="text-[9px] text-muted-foreground">
                      {whenLabel(conversation.updatedAt)} · {conversation.messageCount} messages
                    </p>
                  </button>
                  <button
                    onClick={() => {
                      setRenamingId(conversation.id);
                      setRenameValue(conversation.title);
                      setConfirmDeleteId(null);
                    }}
                    aria-label={`Rename ${conversation.title}`}
                    className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => {
                      if (confirmDeleteId === conversation.id) {
                        void removeConversation(conversation.id);
                      } else {
                        setConfirmDeleteId(conversation.id);
                      }
                    }}
                    aria-label={`Delete ${conversation.title}`}
                    className={cn(
                      'text-[9px] font-bold uppercase tracking-widest',
                      confirmDeleteId === conversation.id ? 'text-rose-600' : 'text-muted-foreground hover:text-rose-600'
                    )}
                  >
                    {confirmDeleteId === conversation.id ? 'Confirm' : 'Delete'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {notice && (
        <p className="text-[10px] leading-relaxed text-muted-foreground bg-muted/40 border border-border rounded-2xl px-3 py-2">
          {notice}{' '}
          <Link to="/settings" className="text-primary underline underline-offset-4">
            Settings
          </Link>
        </p>
      )}

      {sentNote && aiOn && (
        <p className="text-[9px] text-muted-foreground leading-relaxed">
          Sent with your question: {sentNote}. Journal entries and cycle notes are never included.
          Attachments are sent only with the message they belong to.{' '}
          <Link to="/privacy" className="text-primary underline underline-offset-4">
            Details
          </Link>
        </p>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pr-2 scrollbar-hide">
        {booting ? (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <p className="text-[11px]">Opening your conversations...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex gap-3 max-w-[85%] mr-auto">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="p-4 rounded-3xl bg-card border border-border rounded-tl-none text-sm">
              <div className="markdown-body">
                <ReactMarkdown>{WELCOME.text}</ReactMarkdown>
              </div>
            </div>
          </div>
        ) : null}

        <AnimatePresence initial={false}>
          {messages.map((msg, idx) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={cn(
                'flex gap-3 max-w-[85%]',
                msg.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'
              )}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                  msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                )}
              >
                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div
                className={cn(
                  'p-4 rounded-3xl text-sm shadow-sm',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-tr-none'
                    : 'bg-card border border-border rounded-tl-none'
                )}
              >
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {msg.attachments.map(attachment =>
                      attachment.preview ? (
                        <div key={attachment.id} className="relative">
                          <img
                            src={attachment.preview}
                            alt={attachment.name}
                            className="w-36 h-24 object-cover rounded-xl border border-primary-foreground/20"
                          />
                          {attachment.kind === 'video' && (
                            <span className="absolute bottom-1 left-1 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 text-[8px] font-bold uppercase tracking-wider text-white">
                              <Play className="w-2.5 h-2.5" /> Still
                            </span>
                          )}
                        </div>
                      ) : (
                        <div
                          key={attachment.id}
                          className="flex items-center gap-2 max-w-[220px] px-2.5 py-2 rounded-xl bg-primary-foreground/10 border border-primary-foreground/15"
                        >
                          <Paperclip className="w-4 h-4 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold truncate">{attachment.name}</p>
                            <p className="text-[8px] text-primary-foreground/60">
                              {formatBytes(attachment.size)}
                            </p>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )}

                <div className="markdown-body">
                  <ReactMarkdown>{msg.text || '…'}</ReactMarkdown>
                </div>

                {msg.meta && (
                  <p className="mt-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    {msg.meta.provider} · {msg.meta.model}
                  </p>
                )}

                {msg.role === 'model' && msg.id !== WELCOME_ID && (
                  <div className="mt-2">
                    {reportedIds.includes(msg.id) ? (
                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                        Reported, thank you
                      </p>
                    ) : reportingId === msg.id ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[9px] text-muted-foreground">Why?</span>
                        {(['inaccurate', 'unsafe', 'unhelpful', 'other'] as const).map(reason => (
                          <button
                            key={reason}
                            onClick={async () => {
                              const ok = await reportAiReply(reason);
                              setReportingId(null);
                              if (ok) setReportedIds(current => [...current, msg.id]);
                            }}
                            className="px-2 py-1 rounded-full border border-border text-[9px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary hover:border-primary/40"
                          >
                            {reason}
                          </button>
                        ))}
                        <button
                          onClick={() => setReportingId(null)}
                          className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setReportingId(msg.id)}
                        className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 hover:text-primary"
                      >
                        Report reply
                      </button>
                    )}
                  </div>
                )}

                {msg.filed && msg.filed.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {msg.filed.map(item => {
                      const Icon = FILED_ICON[item.kind];
                      const removed = msg.removed?.includes(item.id);
                      return (
                        <div
                          key={item.id}
                          className={cn(
                            'flex items-center gap-2.5 p-2.5 rounded-2xl border border-border bg-background/60',
                            removed && 'opacity-60'
                          )}
                        >
                          <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                            <Icon className="w-4 h-4" />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold truncate">{item.title}</p>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground truncate">
                              {removed ? 'Removed' : item.detail || item.kind}
                            </p>
                          </div>
                          {!removed && (
                            <>
                              <Link
                                to={item.target}
                                className="p-1.5 rounded-full text-primary hover:bg-primary/10 transition-colors"
                                aria-label={`Open ${item.title}`}
                              >
                                <ArrowUpRight className="w-3.5 h-3.5" />
                              </Link>
                              <button
                                onClick={() => handleUndo(idx, item)}
                                className="p-1.5 rounded-full text-muted-foreground/60 hover:bg-rose-50 hover:text-rose-500 transition-colors"
                                aria-label={`Undo ${item.title}`}
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-3 max-w-[85%] mr-auto"
          >
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
            <div className="p-4 rounded-3xl bg-card border border-border rounded-tl-none text-sm text-muted-foreground italic">
              Thinking...
            </div>
          </motion.div>
        )}
      </div>

      <div className="mt-auto space-y-2">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {CAPTURE_EXAMPLES.map(example => (
            <button
              key={example}
              onClick={() => setUserMessage(example)}
              className="shrink-0 px-3 py-1.5 rounded-full bg-card border border-border text-[10px] font-semibold text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
            >
              {example}
            </button>
          ))}
        </div>
        {attachments.length > 0 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {attachments.map(attachment => (
              <div key={attachment.id} className="relative shrink-0 w-16">
                <div className="w-16 h-16 rounded-xl overflow-hidden bg-muted border border-border flex items-center justify-center">
                  {attachment.preview ? (
                    <img
                      src={attachment.preview}
                      alt={attachment.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Paperclip className="w-5 h-5 text-muted-foreground" />
                  )}
                  {attachment.kind === 'video' && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <Play className="w-5 h-5 text-white" />
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[8px] text-muted-foreground truncate" title={attachment.name}>
                  {attachment.name}
                </p>
                <button
                  type="button"
                  onClick={() => setAttachments(prev => prev.filter(item => item.id !== attachment.id))}
                  aria-label={`Remove ${attachment.name}`}
                  className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-foreground text-background shadow-sm"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {attachmentError && (
          <p className="text-[10px] leading-relaxed text-rose-600">{attachmentError}</p>
        )}

        <div className="relative">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,application/pdf,text/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.json,.md,.txt,.rtf,.zip"
            className="hidden"
            onChange={event => {
              const files = Array.from(event.target.files || []);
              event.target.value = '';
              void handleFiles(files);
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || booting || attaching || attachments.length >= MAX_ATTACHMENTS}
            aria-label="Add files, photos or videos"
            title="Add files, photos or videos"
            className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
          >
            {attaching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={userMessage}
            onChange={e => setUserMessage(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Ask anything, or attach a photo or file..."
            aria-label="Message the assistant"
            disabled={isLoading || booting}
            className="w-full py-4 pl-11 pr-24 rounded-3xl bg-card border border-border text-sm focus:outline-none focus:border-primary transition-all shadow-sm resize-none scrollbar-hide"
          />
          <VoiceButton
            className="absolute right-12 top-1/2 -translate-y-1/2"
            onTranscript={text => setUserMessage(prev => appendDictation(prev, text))}
            label="Dictate your message"
          />
          <button
            onClick={() => void handleSend()}
            aria-label="Send message"
            disabled={(!userMessage.trim() && attachments.length === 0) || isLoading || booting}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-primary text-primary-foreground shadow-lg transition-all disabled:opacity-50 disabled:scale-100"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AICoach;
