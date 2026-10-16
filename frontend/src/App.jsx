import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppLayout from './components/AppLayout';
import AccessGate from './components/AccessGate';
import LandingPage from './pages/LandingPage';
import AuthPage from './pages/AuthPage';
import PasswordResetPage from './pages/PasswordResetPage';
import DashboardPage from './pages/DashboardPage';
import LearnPage from './pages/LearnPage';
import QuizPage from './pages/QuizPage';
import ReviewPage from './pages/ReviewPage';
import CivicExamPage from './pages/CivicExamPage';
import JourneyPage from './pages/JourneyPage';
import SpeedChallengePage from './pages/SpeedChallengePage';
import CompendiumPage from './pages/CompendiumPage';
import ProgressPage from './pages/ProgressPage';
import PricingPage from './pages/PricingPage';
import ProfilePage from './pages/ProfilePage';
import LearnerCoursesPage from './pages/LearnerCoursesPage';
import TrainerPage from './pages/TrainerPage';
import AdminPage from './pages/AdminPage';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Chargement…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RoleRoute({ roles, children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Chargement…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/app" replace />;
  return children;
}

function RoleHome(){
  const {user,loading}=useAuth();
  if(loading)return <div className="center-screen">Chargement…</div>;
  if(user?.role==='admin')return <Navigate to="/app/admin/overview" replace/>;
  if(user?.role==='trainer')return <Navigate to="/app/trainer/overview" replace/>;
  return <DashboardPage/>;
}

export default function App() {
  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/register" element={<AuthPage mode="register" />} />
    <Route path="/forgot-password" element={<PasswordResetPage />} />
    <Route path="/reset-password" element={<PasswordResetPage />} />
    <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
      <Route index element={<RoleHome/>}/>
      <Route path="learn" element={<LearnPage />} />
      <Route path="quiz" element={<QuizPage />} />
      <Route path="review" element={<ReviewPage />} />
      <Route path="civic-exam" element={<CivicExamPage />} />
      <Route path="journey" element={<AccessGate feature="journey"><JourneyPage /></AccessGate>} />
      <Route path="speed" element={<AccessGate feature="speed"><SpeedChallengePage /></AccessGate>} />
      <Route path="compendium" element={<AccessGate feature="compendium"><CompendiumPage /></AccessGate>} />
      <Route path="progress" element={<ProgressPage />} />
      <Route path="pricing" element={<PricingPage />} />
      <Route path="profile" element={<ProfilePage />} />
      <Route path="courses" element={<LearnerCoursesPage />} />
      <Route path="trainer" element={<RoleRoute roles={['trainer','admin']}><TrainerPage /></RoleRoute>} />
      <Route path="trainer/:tab" element={<RoleRoute roles={['trainer','admin']}><TrainerPage /></RoleRoute>} />
      <Route path="admin" element={<RoleRoute roles={['admin']}><AdminPage /></RoleRoute>} />
      <Route path="admin/:tab" element={<RoleRoute roles={['admin']}><AdminPage /></RoleRoute>} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
