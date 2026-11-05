import type { ComponentType } from 'react';
import type { IconProps } from '../components/icons';
import {
  Activity,
  AlertCircle,
  Bed,
  Book,
  BookOpen,
  Briefcase,
  Calendar,
  Cloud,
  CloudSun,
  Coffee,
  DollarSign,
  Feather,
  Flame,
  Frown,
  Heart,
  HeartPulse,
  Home,
  Lightbulb,
  Meh,
  Moon,
  Palette,
  ShieldCheck,
  Smile,
  Star,
  Sun,
  Tag,
  Target,
  Thermometer,
  Users,
  Utensils,
  Waves,
  Wind,
  Zap,
} from '../components/icons';

export interface MoodOption {
  id: string;
  label: string;
  icon: ComponentType<IconProps>;
  color: string;
  activeColor: string;
  custom?: boolean;
}

export interface FactorOption {
  id: string;
  label: string;
  icon: ComponentType<IconProps>;
  custom?: boolean;
}

const WARM = 'bg-[#E3D6B8] text-[#95714F] border-[#C7AF94]';
const WARM_ACTIVE = 'bg-[#DCC6B4] text-[#4A3728] border-[#95714F]';
const SAND = 'bg-[#DCC6B4] text-[#95714F] border-[#C7AF94]';
const SAND_ACTIVE = 'bg-[#D8B5AE] text-[#4A3728] border-[#95714F]';
const GREEN = 'bg-[#CBD3B6] text-[#8C916C] border-[#ACB087]';
const GREEN_ACTIVE = 'bg-[#ACB087] text-primary-foreground border-[#8C916C]';
const BLUE = 'bg-[#B9CDCB] text-[#4A3728] border-[#C7AF94]';
const BLUE_ACTIVE = 'bg-[#95714F] text-primary-foreground border-[#95714F]';
const STONE = 'bg-[#C9BEB4] text-[#95714F] border-[#C7AF94]';
const STONE_ACTIVE = 'bg-[#C7AF94] text-primary-foreground border-[#C7AF94]';
const ROSE = 'bg-[#D8B5AE] text-[#95714F] border-[#C7AF94]';
const ROSE_ACTIVE = 'bg-[#95714F] text-primary-foreground border-[#95714F]';

export const BUILT_IN_MOODS: MoodOption[] = [
  { id: 'radiant', label: 'Radiant', icon: Sun, color: WARM, activeColor: WARM_ACTIVE },
  { id: 'joyful', label: 'Joyful', icon: Smile, color: SAND, activeColor: SAND_ACTIVE },
  { id: 'calm', label: 'Calm', icon: Wind, color: GREEN, activeColor: GREEN_ACTIVE },
  { id: 'focused', label: 'Focused', icon: Target, color: BLUE, activeColor: BLUE_ACTIVE },
  { id: 'creative', label: 'Creative', icon: Palette, color: STONE, activeColor: STONE_ACTIVE },
  { id: 'social', label: 'Social', icon: Users, color: SAND, activeColor: GREEN_ACTIVE },
  { id: 'energized', label: 'Energized', icon: Zap, color: WARM, activeColor: GREEN_ACTIVE },
  { id: 'content', label: 'Content', icon: Meh, color: GREEN, activeColor: STONE_ACTIVE },
  { id: 'tired', label: 'Tired', icon: Moon, color: STONE, activeColor: 'bg-[#4A3728] text-primary-foreground border-[#4A3728]' },
  { id: 'low', label: 'Low', icon: Cloud, color: BLUE, activeColor: BLUE_ACTIVE },
  { id: 'anxious', label: 'Anxious', icon: AlertCircle, color: ROSE, activeColor: STONE_ACTIVE },
  { id: 'stressed', label: 'Stressed', icon: Waves, color: BLUE, activeColor: GREEN_ACTIVE },
  { id: 'frustrated', label: 'Frustrated', icon: Flame, color: ROSE, activeColor: BLUE_ACTIVE },
  { id: 'recovering', label: 'Recovering', icon: Thermometer, color: GREEN, activeColor: GREEN_ACTIVE },
  { id: 'reflective', label: 'Reflective', icon: Book, color: STONE, activeColor: STONE_ACTIVE },
  { id: 'happy', label: 'Happy', icon: Smile, color: WARM, activeColor: GREEN_ACTIVE },
  { id: 'sad', label: 'Sad', icon: Frown, color: BLUE, activeColor: BLUE_ACTIVE },
  { id: 'excited', label: 'Excited', icon: Zap, color: SAND, activeColor: SAND_ACTIVE },
  { id: 'motivated', label: 'Motivated', icon: Target, color: GREEN, activeColor: BLUE_ACTIVE },
  { id: 'overwhelmed', label: 'Overwhelmed', icon: Waves, color: ROSE, activeColor: GREEN_ACTIVE },
  { id: 'lonely', label: 'Lonely', icon: Cloud, color: BLUE, activeColor: STONE_ACTIVE },
  { id: 'grateful', label: 'Grateful', icon: Heart, color: GREEN, activeColor: GREEN_ACTIVE },
  { id: 'confident', label: 'Confident', icon: ShieldCheck, color: WARM, activeColor: BLUE_ACTIVE },
  { id: 'peaceful', label: 'Peaceful', icon: Feather, color: GREEN, activeColor: GREEN_ACTIVE },
  { id: 'loved', label: 'Loved', icon: HeartPulse, color: ROSE, activeColor: STONE_ACTIVE },
  { id: 'inspired', label: 'Inspired', icon: Lightbulb, color: WARM, activeColor: GREEN_ACTIVE },
  { id: 'optimistic', label: 'Optimistic', icon: Sun, color: WARM, activeColor: WARM_ACTIVE },
];

export const BUILT_IN_FACTORS: FactorOption[] = [
  { id: 'work', label: 'Work', icon: Briefcase },
  { id: 'relationships', label: 'Relationships', icon: Heart },
  { id: 'sleep', label: 'Sleep', icon: Bed },
  { id: 'food', label: 'Food', icon: Utensils },
  { id: 'health', label: 'Health', icon: Activity },
  { id: 'weather', label: 'Weather', icon: CloudSun },
  { id: 'finances', label: 'Finances', icon: DollarSign },
  { id: 'hobby', label: 'Hobby', icon: Palette },
  { id: 'social', label: 'Social', icon: Users },
  { id: 'home', label: 'Home', icon: Home },
  { id: 'personal', label: 'Personal', icon: Star },
  { id: 'routine', label: 'Routine', icon: Coffee },
  { id: 'school', label: 'School', icon: BookOpen },
  { id: 'holiday', label: 'Holiday', icon: Calendar },
  { id: 'friends', label: 'Friends', icon: Users },
];

const CUSTOM_MOODS_KEY = 'serene_custom_moods_v1';
const CUSTOM_FACTORS_KEY = 'serene_custom_factors_v1';
const OPTIONS_CHANGED = 'serene:mood-options-changed';
const MAX_LABEL_LENGTH = 32;

interface SavedOption {
  id: string;
  label: string;
}

function cleanLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL_LENGTH).trim();
}

function makeId(kind: 'mood' | 'factor'): string {
  return `custom-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function readSaved(key: string): SavedOption[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.flatMap((item) => {
      if (!item || typeof item.id !== 'string' || typeof item.label !== 'string') return [];
      const label = cleanLabel(item.label);
      if (!label || seen.has(item.id)) return [];
      seen.add(item.id);
      return [{ id: item.id, label }];
    }).slice(0, 40);
  } catch {
    return [];
  }
}

function writeSaved(key: string, options: SavedOption[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(options));
  } catch {
    // A full or unavailable browser store should not stop the check-in.
  }
}

function notifyOptionsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(OPTIONS_CHANGED));
}

function moodFromSaved(option: SavedOption): MoodOption {
  return {
    id: option.id,
    label: option.label,
    icon: Star,
    color: WARM,
    activeColor: WARM_ACTIVE,
    custom: true,
  };
}

function factorFromSaved(option: SavedOption): FactorOption {
  return {
    id: option.id,
    label: option.label,
    icon: Tag,
    custom: true,
  };
}

export function loadCustomMoods(): MoodOption[] {
  return readSaved(CUSTOM_MOODS_KEY).map(moodFromSaved);
}

export function loadCustomFactors(): FactorOption[] {
  return readSaved(CUSTOM_FACTORS_KEY).map(factorFromSaved);
}

export function createCustomMood(label: string): MoodOption | null {
  const clean = cleanLabel(label);
  if (!clean) return null;
  return moodFromSaved({ id: makeId('mood'), label: clean });
}

export function createCustomFactor(label: string): FactorOption | null {
  const clean = cleanLabel(label);
  if (!clean) return null;
  return factorFromSaved({ id: makeId('factor'), label: clean });
}

export function saveCustomMood(label: string): MoodOption | null {
  const clean = cleanLabel(label);
  if (!clean) return null;
  const existing = readSaved(CUSTOM_MOODS_KEY).find(
    (option) => option.label.toLowerCase() === clean.toLowerCase(),
  );
  if (existing) return moodFromSaved(existing);
  const saved = { id: makeId('mood'), label: clean };
  writeSaved(CUSTOM_MOODS_KEY, [...readSaved(CUSTOM_MOODS_KEY), saved]);
  notifyOptionsChanged();
  return moodFromSaved(saved);
}

export function saveCustomFactor(label: string): FactorOption | null {
  const clean = cleanLabel(label);
  if (!clean) return null;
  const existing = readSaved(CUSTOM_FACTORS_KEY).find(
    (option) => option.label.toLowerCase() === clean.toLowerCase(),
  );
  if (existing) return factorFromSaved(existing);
  const saved = { id: makeId('factor'), label: clean };
  writeSaved(CUSTOM_FACTORS_KEY, [...readSaved(CUSTOM_FACTORS_KEY), saved]);
  notifyOptionsChanged();
  return factorFromSaved(saved);
}

export function subscribeMoodOptions(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(OPTIONS_CHANGED, listener);
  return () => window.removeEventListener(OPTIONS_CHANGED, listener);
}
