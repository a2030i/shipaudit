import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../lib/auth.jsx';
import { supabase } from '../../lib/supabase.js';
import MailDashboard  from './MailDashboard.jsx';
import TaskDetail     from './TaskDetail.jsx';
import NewTaskModal   from './NewTaskModal.jsx';
import UserManagement from './UserManagement.jsx';

export default function MailApp({ onNotification }) {
  const { profile } = useAuth();
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [showNew,        setShowNew]         = useState(false);
  const [showUsers,      setShowUsers]       = useState(false);
  const [refreshSignal,  setRefreshSignal]   = useState(0);
  const channelRef = useRef(null);

  const refresh = () => setRefreshSignal(s => s + 1);

  // Realtime: refresh task list on any task change
  useEffect(() => {
    const ch = supabase.channel('mail_tasks_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, refresh)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
      }, () => { onNotification?.(); })
      .subscribe();
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column' }}>

      {/* Admin toolbar */}
      {profile?.role === 'admin' && (
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'flex-end',
          padding:'6px 16px', borderBottom:'1px solid var(--border)',
          background:'var(--bg2)', gap:8, flexShrink:0,
        }}>
          <button onClick={() => setShowUsers(true)} style={{
            background:'var(--surface)', border:'1px solid var(--border2)',
            color:'var(--muted)', borderRadius:7, fontSize:11,
            padding:'4px 10px', cursor:'pointer', display:'flex', alignItems:'center', gap:5,
          }}>
            👥 إدارة المستخدمين
          </button>
        </div>
      )}

      {/* Main split: list | detail */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        {/* Task list */}
        <div style={{
          width: selectedTaskId ? 320 : '100%',
          minWidth: selectedTaskId ? 260 : undefined,
          borderLeft: selectedTaskId ? '1px solid var(--border)' : 'none',
          flexShrink:0, overflow:'hidden',
          display:'flex', flexDirection:'column',
          transition:'width .2s',
        }}>
          <MailDashboard
            onSelectTask={setSelectedTaskId}
            onNewTask={profile?.role === 'admin' ? () => setShowNew(true) : undefined}
            refreshSignal={refreshSignal}
          />
        </div>

        {/* Task detail */}
        {selectedTaskId && (
          <div style={{ flex:1, overflow:'hidden' }}>
            <TaskDetail
              taskId={selectedTaskId}
              onClose={() => setSelectedTaskId(null)}
              onUpdated={refresh}
            />
          </div>
        )}
      </div>

      {showNew && (
        <NewTaskModal
          onClose={() => setShowNew(false)}
          onCreated={() => { refresh(); setShowNew(false); }}
        />
      )}

      {showUsers && <UserManagement onClose={() => setShowUsers(false)}/>}
    </div>
  );
}
