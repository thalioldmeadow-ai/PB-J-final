/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider } from './components/ThemeProvider';
import { AuthProvider, useAuth } from './components/AuthProvider';
import Layout from './components/Layout';
import Home from './pages/Home';
import Lists from './pages/Lists';
import Plan from './pages/Plan';
import Journal from './pages/Journal';
import Settings from './pages/Settings';
import Routines from './pages/Routines';
import Challenges from './pages/Challenges';
import AICoach from './pages/AICoach';
import AdminAi from './pages/AdminAi';
import Health from './pages/Health';
import CycleTracking from './pages/CycleTracking';
import CycleInfo from './pages/CycleInfo';
import AddMeal from './pages/AddMeal';
import AssignMeal from './pages/AssignMeal';
import ShoppingList from './pages/ShoppingList';
import AddWorkout from './pages/AddWorkout';
import AssignWorkout from './pages/AssignWorkout';
import MealDetail from './pages/MealDetail';
import WorkoutDetail from './pages/WorkoutDetail';
import Sleep from './pages/Sleep';
import Nutrition from './pages/Nutrition';
import Activity from './pages/Activity';
import Mood from './pages/Mood';
import CyclePhaseDetail from './pages/CyclePhaseDetail';
import CreateRoutine from './pages/CreateRoutine';
import Recipes from './pages/Recipes';
import { Onboarding } from './components/Onboarding';
import { PrivacyPolicy, TermsAndConditions, CookiePolicy, About } from './pages/Legal';
import { EmailVerified, ResetPassword } from './pages/AuthStatus';
import { Lightbulb } from './components/icons';

const onboardedKey = (uid: string) => `serene.onboarded.${uid}`;

function AppContent() {
  const { user, loading } = useAuth();
  const path = useLocation().pathname.replace(/\/+$/, '') || '/';
  const [hasOnboarded, setHasOnboarded] = React.useState(false);

  // The welcome flow belongs to an account, so a new account sees it once.
  React.useEffect(() => {
    setHasOnboarded(user ? localStorage.getItem(onboardedKey(user.uid)) === 'true' : false);
  }, [user]);

  // Email confirmation and password reset are reached from an email link and
  // must work before this browser has an unlocked vault.
  if (path === '/auth/verified') return <EmailVerified />;
  if (path === '/auth/reset') return <ResetPassword />;

  // Policy pages stay readable without an account, since they describe what an
  // account would store.
  if (path === '/privacy') return <PrivacyPolicy />;
  if (path === '/terms') return <TermsAndConditions />;
  if (path === '/cookies') return <CookiePolicy />;
  if (path === '/about') return <About />;

  if (loading) {
    return (
      <div className="fixed inset-0 bg-background  flex flex-col items-center justify-center gap-3">
        <div className="p-4 rounded-sm bg-card/60  border border-amber-950/10  text-primary">
        </div>
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Unlocking your space…</p>
      </div>
    );
  }

  if (!user || !hasOnboarded) {
    return (
      <Onboarding
        onComplete={() => {
          if (user) localStorage.setItem(onboardedKey(user.uid), 'true');
          setHasOnboarded(true);
        }}
      />
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/lists" element={<Lists />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/meal/:id" element={<MealDetail />} />
        <Route path="/workout/:id" element={<WorkoutDetail />} />
        <Route path="/journal" element={<Journal />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/create-routine" element={<CreateRoutine />} />
        <Route path="/routines" element={<Routines />} />
        <Route path="/challenges" element={<Challenges />} />
        <Route path="/ai-coach" element={<AICoach />} />
        <Route path="/admin/ai" element={<AdminAi />} />
        <Route path="/health" element={<Health />} />
        <Route path="/health/cycle" element={<CycleTracking />} />
        <Route path="/health/cycle/info" element={<CycleInfo />} />
        <Route path="/health/cycle/phase/:phaseId" element={<CyclePhaseDetail />} />
        <Route path="/health/sleep" element={<Sleep />} />
        <Route path="/health/nutrition" element={<Nutrition />} />
        <Route path="/health/activity" element={<Activity />} />
        <Route path="/health/mood" element={<Mood />} />
        <Route path="/add-meal" element={<AddMeal />} />
        <Route path="/assign-meal" element={<AssignMeal />} />
        <Route path="/shopping-list" element={<ShoppingList />} />
        <Route path="/add-workout" element={<AddWorkout />} />
        <Route path="/assign-workout" element={<AssignWorkout />} />
        <Route path="/recipes" element={<Recipes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <Router>
          <AppContent />
        </Router>
      </ThemeProvider>
    </AuthProvider>
  );
}
