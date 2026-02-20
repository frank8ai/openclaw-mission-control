'use client';

import { useState } from 'react';

export default function SettingsPage() {
  const [dataRoot, setDataRoot] = useState('/Users/yizhi/.openclaw/workspace');
  const [location, setLocation] = useState('Shanghai, People\'s Square');
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [todoistConfigured, setTodoistConfigured] = useState(false);
  const [xConfigured, setXConfigured] = useState(false);

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">⚙️ Settings</h1>
      
      <div className="space-y-6">
        {/* Data Root */}
        <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <label className="block text-sm font-medium mb-2">Data Root Directory</label>
          <input 
            value={dataRoot}
            onChange={e => setDataRoot(e.target.value)}
            className="w-full p-2 bg-zinc-950 border border-zinc-800 rounded text-sm"
          />
        </div>
        
        {/* Location */}
        <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <label className="block text-sm font-medium mb-2">Location (Weather)</label>
          <input 
            value={location}
            onChange={e => setLocation(e.target.value)}
            className="w-full p-2 bg-zinc-950 border border-zinc-800 rounded text-sm"
          />
        </div>

        {/* Integrations Status */}
        <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h3 className="text-sm font-medium mb-4">🔌 Integrations Status</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span>Telegram</span>
              <button 
                onClick={() => setTelegramConfigured(!telegramConfigured)}
                className={`px-3 py-1 rounded text-xs ${telegramConfigured ? 'bg-green-900 text-green-200' : 'bg-zinc-800'}`}
              >
                {telegramConfigured ? 'Configured' : 'Not Configured'}
              </button>
            </div>
            <div className="flex justify-between items-center">
              <span>Todoist</span>
              <button 
                onClick={() => setTodoistConfigured(!todoistConfigured)}
                className={`px-3 py-1 rounded text-xs ${todoistConfigured ? 'bg-green-900 text-green-200' : 'bg-zinc-800'}`}
              >
                {todoistConfigured ? 'Configured' : 'Not Configured'}
              </button>
            </div>
            <div className="flex justify-between items-center">
              <span>X/Twitter</span>
              <button 
                onClick={() => setXConfigured(!xConfigured)}
                className={`px-3 py-1 rounded text-xs ${xConfigured ? 'bg-green-900 text-green-200' : 'bg-zinc-800'}`}
              >
                {xConfigured ? 'Configured' : 'Not Configured'}
              </button>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <button className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded-lg">
          Save Settings
        </button>
      </div>
    </div>
  );
}
