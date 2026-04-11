import React, { useState, useEffect } from 'react';

export function SettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    const savedKey = localStorage.getItem('GEMINI_API_KEY');
    if (savedKey) setApiKey(savedKey);
  }, [isOpen]);

  const saveKey = () => {
    localStorage.setItem('GEMINI_API_KEY', apiKey);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-surface-container-high border border-outline-variant/30 p-8 rounded-xl shadow-2xl max-w-md w-full relative">
        <h2 className="text-xl font-headline font-bold text-on-surface mb-2">Settings</h2>
        <p className="text-on-surface-variant font-body text-sm mb-6">Enter your Gemini API Key to enable ambient image generation.</p>
        
        <input 
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="AIzaSy..."
          className="w-full bg-surface-container-highest border border-outline-variant text-on-surface p-3 rounded-lg focus:outline-none focus:border-primary mb-6 transition-colors"
        />
        
        <div className="flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-on-surface-variant hover:text-on-surface transition-colors font-label font-medium uppercase text-sm"
          >
            Close
          </button>
          <button 
            onClick={saveKey}
            className="px-6 py-2 bg-primary text-on-primary rounded-lg font-label font-bold uppercase text-sm hover:brightness-110 transition-all cursor-pointer"
          >
            Save Key
          </button>
        </div>
      </div>
    </div>
  );
}
