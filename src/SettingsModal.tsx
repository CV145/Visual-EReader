import React, { useState, useEffect } from 'react';
import { localImageEngine } from './localImageEngine';
export function SettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [includeCharacters, setIncludeCharacters] = useState(false);
  const [imageStyle, setImageStyle] = useState('cinematic');
  const [isStretchImage, setIsStretchImage] = useState(false);
  
  // Local AI Settings
  const [imageProvider, setImageProvider] = useState<'cloud' | 'local'>('cloud');
  const [modelStatus, setModelStatus] = useState<string>('');
  const [isModelDownloaded, setIsModelDownloaded] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem('GEMINI_API_KEY');
    if (savedKey) setApiKey(savedKey);
    const savedCharPref = localStorage.getItem('INCLUDE_CHARACTERS');
    setIncludeCharacters(savedCharPref === 'true');
    const savedStyle = localStorage.getItem('IMAGE_STYLE_PREF');
    if (savedStyle) setImageStyle(savedStyle);
    const stretchPref = localStorage.getItem('STRETCH_IMAGE');
    setIsStretchImage(stretchPref === 'true');
    
    const savedProvider = localStorage.getItem('IMAGE_GEN_PROVIDER') as 'cloud' | 'local';
    if (savedProvider) setImageProvider(savedProvider);
    
    setIsModelDownloaded(localImageEngine.isModelDownloaded());
  }, [isOpen]);

  const saveSettings = () => {
    localStorage.setItem('GEMINI_API_KEY', apiKey);
    localStorage.setItem('INCLUDE_CHARACTERS', includeCharacters ? 'true' : 'false');
    localStorage.setItem('IMAGE_STYLE_PREF', imageStyle);
    localStorage.setItem('STRETCH_IMAGE', isStretchImage ? 'true' : 'false');
    localStorage.setItem('IMAGE_GEN_PROVIDER', imageProvider);
    onClose();
  };

  const handleDownloadModel = async () => {
    try {
      await localImageEngine.setup((status) => setModelStatus(status));
      setIsModelDownloaded(true);
      setTimeout(() => setModelStatus(''), 3000);
    } catch (e: any) {
      setModelStatus(`Download failed: ${e.message}`);
    }
  };

  const handleDeleteModel = async () => {
    await localImageEngine.deleteModel();
    setIsModelDownloaded(false);
    setModelStatus('Model deleted.');
    setTimeout(() => setModelStatus(''), 3000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-surface-container-high border border-outline-variant/30 p-8 rounded-xl shadow-2xl max-w-md w-full relative max-h-[90vh] overflow-y-auto">
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

        {/* Provider Toggle */}
        <div className="flex bg-surface-container-highest rounded-lg p-1 mb-4 border border-outline-variant/30">
          <button 
            onClick={() => setImageProvider('cloud')}
            className={`flex-1 py-2 text-sm font-label uppercase rounded-md transition-colors ${imageProvider === 'cloud' ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            Cloud (Gemini)
          </button>
          <button 
            onClick={() => setImageProvider('local')}
            className={`flex-1 py-2 text-sm font-label uppercase rounded-md transition-colors ${imageProvider === 'local' ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            Local (SD-Turbo)
          </button>
        </div>

        {/* Local Model Manager */}
        {imageProvider === 'local' && (
          <div className="mb-4 p-4 border border-outline-variant/30 rounded-lg bg-surface-container/50">
            <h3 className="text-sm font-bold text-on-surface mb-2">Local Image Model Manager</h3>
            <p className="text-xs text-on-surface-variant mb-4">Requires ~2GB of storage. Uses your local GPU for private image generation.</p>
            
            <div className="flex gap-2">
              {!isModelDownloaded ? (
                <button onClick={handleDownloadModel} className="flex-1 bg-primary/20 text-primary hover:bg-primary hover:text-on-primary py-2 rounded font-bold text-xs uppercase transition-colors">
                  Download Model
                </button>
              ) : (
                <button onClick={handleDeleteModel} className="flex-1 bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white py-2 rounded font-bold text-xs uppercase transition-colors">
                  Delete Model
                </button>
              )}
            </div>
            {modelStatus && <p className="text-xs text-primary mt-2 font-mono">{modelStatus}</p>}
          </div>
        )}
        
        <div className="mb-4">
          <label className="block text-on-surface text-sm font-body mb-2">Art Style (Cloud Only)</label>
          <select
            value={imageStyle}
            onChange={(e) => setImageStyle(e.target.value)}
            disabled={imageProvider === 'local'}
            className="w-full bg-surface-container-highest border border-outline-variant text-on-surface p-3 rounded-lg focus:outline-none focus:border-primary transition-colors appearance-none cursor-pointer disabled:opacity-50"
          >
            <option value="cinematic">Default Cinematic</option>
            <option value="manga">Manga</option>
            <option value="tabletop">Topdown Tabletop Minifigures</option>
            <option value="comic-book">Graphic Novel / Comic Cells</option>
            <option value="pixel-art">2D Pixel Art</option>
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
            disabled={imageProvider === 'local'}
            onChange={(e) => setIncludeCharacters(e.target.checked)}
            className="w-5 h-5 rounded border-2 border-outline-variant bg-surface-container-highest accent-primary cursor-pointer disabled:opacity-50"
          />
          <span className="text-on-surface font-body text-sm group-hover:text-primary transition-colors select-none">
            Include characters in generated images (Cloud Only)
          </span>
        </label>
        
        <div className="flex justify-end gap-3 mt-4">
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