import React, { useState, useEffect } from 'react';

export function SettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [includeCharacters, setIncludeCharacters] = useState(false);
  const [imageStyle, setImageStyle] = useState('cinematic');
  const [isStretchImage, setIsStretchImage] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem('GEMINI_API_KEY');
    if (savedKey) setApiKey(savedKey);
    const savedCharPref = localStorage.getItem('INCLUDE_CHARACTERS');
    setIncludeCharacters(savedCharPref === 'true');
    const savedStyle = localStorage.getItem('IMAGE_STYLE_PREF');
    if (savedStyle) setImageStyle(savedStyle);
    const stretchPref = localStorage.getItem('STRETCH_IMAGE');
    setIsStretchImage(stretchPref === 'true');
  }, [isOpen]);

  const saveSettings = () => {
    localStorage.setItem('GEMINI_API_KEY', apiKey);
    localStorage.setItem('INCLUDE_CHARACTERS', includeCharacters ? 'true' : 'false');
    localStorage.setItem('IMAGE_STYLE_PREF', imageStyle);
    localStorage.setItem('STRETCH_IMAGE', isStretchImage ? 'true' : 'false');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-surface-container-high border border-outline-variant/30 p-8 rounded-xl shadow-2xl max-w-md w-full relative">
        <h2 className="text-xl font-headline font-bold text-on-surface mb-2">Settings</h2>
        <p className="text-on-surface-variant font-body text-sm mb-6">Configure your Nocturne reading experience.</p>
        
        {/* API Key */}
        <label className="block text-on-surface-variant font-label text-xs uppercase tracking-widest mb-2">Gemini API Key</label>
        <input 
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="AIzaSy..."
          className="w-full bg-surface-container-highest border border-outline-variant text-on-surface p-3 rounded-lg focus:outline-none focus:border-primary mb-6 transition-colors"
        />
        
        {/* Image Generation Options */}
        <label className="block text-on-surface-variant font-label text-xs uppercase tracking-widest mb-3">Image Generation</label>
        
        <div className="mb-4">
          <label className="block text-on-surface text-sm font-body mb-2">Art Style</label>
          <select
            value={imageStyle}
            onChange={(e) => setImageStyle(e.target.value)}
            className="w-full bg-surface-container-highest border border-outline-variant text-on-surface p-3 rounded-lg focus:outline-none focus:border-primary transition-colors appearance-none cursor-pointer"
          >
            <option value="cinematic">Default Cinematic</option>
            <option value="visual-novel">1st Person POV Visual Novel</option>
            <option value="tabletop">Topdown Tabletop Minifigures</option>
            <option value="comic-book">Graphic Novel / Comic Cells</option>
            <option value="character-portraits">Character Portraits</option>
          </select>
        </div>

        {/* Mode Toggles */}
        <label className="block text-on-surface-variant font-label text-xs uppercase tracking-widest mb-3 mt-6">Reading Modes</label>

        <label className="flex items-center gap-3 cursor-pointer mb-6 group">
          <input 
            type="checkbox"
            checked={isStretchImage}
            onChange={(e) => setIsStretchImage(e.target.checked)}
            className="w-5 h-5 rounded border-2 border-outline-variant bg-surface-container-highest accent-primary cursor-pointer"
          />
          <span className="text-on-surface font-body text-sm group-hover:text-primary transition-colors select-none">
            Scale image to cover edge-to-edge (Visual Novel Mode)
          </span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer mb-6 group">
          <input 
            type="checkbox"
            checked={includeCharacters}
            onChange={(e) => setIncludeCharacters(e.target.checked)}
            className="w-5 h-5 rounded border-2 border-outline-variant bg-surface-container-highest accent-primary cursor-pointer"
          />
          <span className="text-on-surface font-body text-sm group-hover:text-primary transition-colors select-none">
            Include characters in generated images
          </span>
        </label>
        
        <div className="flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-on-surface-variant hover:text-on-surface transition-colors font-label font-medium uppercase text-sm cursor-pointer"
          >
            Close
          </button>
          <button 
            onClick={saveSettings}
            className="px-6 py-2 bg-primary text-on-primary rounded-lg font-label font-bold uppercase text-sm hover:brightness-110 transition-all cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
