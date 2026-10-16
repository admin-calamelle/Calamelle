import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function PageHeader({ eyebrow, title, subtitle, actions }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="page-header-actions">
        {actions}
        {user ? (
          <button className="profile-pill" onClick={() => navigate('/app/profile')}><UserRound size={18}/><span>{user.name}</span></button>
        ) : (
          <button className="btn btn-ghost" onClick={() => navigate('/login')}><LogIn size={17}/> Se connecter</button>
        )}
      </div>
    </header>
  );
}
