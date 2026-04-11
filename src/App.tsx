import React, { useState, useEffect, useRef } from 'react';
import ePub from 'epubjs';
import localforage from 'localforage';
import { SettingsModal } from './SettingsModal';
import { generateAmbientImage } from './gemini';

export default function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [bookTitle, setBookTitle] = useState('NOCTURNE READER');
  const [chapterTitle, setChapterTitle] = useState('Welcome');
  const [bookLoaded, setBookLoaded] = useState(false);
  const [bgImage, setBgImage] = useState('https://lh3.googleusercontent.com/aida-public/AB6AXuBd5IsdtuXAefa1sVo5e0KSQOMgbc-FQHAE7KUQX1EnW6K8GRXOzBDNJn-U2nqluHhiNQOFPMCYjkNqdcTGiV-menxkJbW5T8HVMi2qalHeVEdy9mbVGLL-ESF0tp7wbf80Wyo47iImNnXPfgNfpKZt7V7TNSBGaTKZRlCHtkqfI1z2kH86RiaPLdWeCFELkpNVnEODNuQfWvEgKbfJuEDAkijghFuxBb--aNKMhFgDNG4-rR80RXhUp9X3YYAPpxnkYVUbWCvX1s5f');
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [currentContextText, setCurrentContextText] = useState('');
  
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<any>(null);
  const renditionRef = useRef<any>(null);

  useEffect(() => {
    // Check locally saved book on load
    localforage.getItem('savedBook').then((savedBookArrayBuffer) => {
      if (savedBookArrayBuffer) {
        initEpub(savedBookArrayBuffer);
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') nextPage();
      if (e.key === 'ArrowLeft') prevPage();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const arrayBuffer = await file.arrayBuffer();
      await localforage.setItem('savedBook', arrayBuffer);
      
      // Cleanup previous rendition if exists
      if (renditionRef.current) {
        renditionRef.current.destroy();
      }
      
      initEpub(arrayBuffer);
    }
  };

  const initEpub = (bookData: ArrayBuffer | string) => {
    bookRef.current = ePub(bookData as any);
    
    bookRef.current.loaded.metadata.then((metadata: any) => {
      setBookTitle(metadata.title || 'Unknown Title');
    });

    bookRef.current.ready.then(() => {
        setBookLoaded(true);
        if (viewerRef.current) {
            renditionRef.current = bookRef.current.renderTo(viewerRef.current, {
                width: '100%',
                height: '100%',
                manager: 'continuous',
                flow: 'paginated',
                spread: 'none',
                snap: true
            });

            // Force white text + transparent backgrounds inside the epub iframe, and prevent image pagination jamming
            renditionRef.current.themes.default({
                '*': { 'color': '#ffffff !important', 'background': 'transparent !important' },
                'body': { 'margin': '0 !important', 'padding': '0 !important' },
                'a': { 'color': '#c6c6c6 !important' },
                'img': { 'background': 'transparent !important', 'max-width': '100% !important', 'max-height': '80vh !important', 'object-fit': 'contain !important', 'display': 'block !important', 'margin': '0 auto !important', 'page-break-inside': 'avoid !important', 'break-inside': 'avoid !important' },
                'svg': { 'background': 'transparent !important', 'max-width': '100% !important', 'max-height': '80vh !important', 'width': '100% !important', 'height': 'auto !important', 'page-break-inside': 'avoid !important', 'break-inside': 'avoid !important' },
                'figure': { 'page-break-inside': 'avoid !important', 'break-inside': 'avoid !important' },
                'div': { 'max-width': '100% !important' },
                'p': { 'max-width': '100% !important' }
            });
            
            // Try to load last location
            localforage.getItem('epubLocation').then((loc) => {
               if (loc) {
                   renditionRef.current.display(loc as string);
               } else {
                   renditionRef.current.display();
               }
            });

            // Bind keyboard controls inside the iframe focus context
            renditionRef.current.on('keyup', (e: KeyboardEvent) => {
                if (e.key === 'ArrowRight') nextPage();
                if (e.key === 'ArrowLeft') prevPage();
            });
            renditionRef.current.on('keydown', (e: KeyboardEvent) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') e.preventDefault();
            });

            renditionRef.current.on('relocated', (location: any) => {
                try {
                    if (!location || !location.start || !location.start.cfi) return;

                    localforage.setItem('epubLocation', location.start.cfi);
                    
                    // Update Chapter Title
                    try {
                        const toc = bookRef.current.navigation?.toc;
                        if (toc && toc.length > 0) {
                        const findChapter = (items: any[], href: string): any => {
                            for (const item of items) {
                                if (href.includes(item.href)) return item;
                                if (item.subitems) {
                                    const sub = findChapter(item.subitems, href);
                                    if (sub) return sub;
                                }
                            }
                            return null;
                        };
                        
                        const spineItem = bookRef.current.spine.get(location.start.cfi);
                        if (spineItem) {
                            const chapter = findChapter(toc, spineItem.href);
                            if (chapter) setChapterTitle(chapter.label);
                        }
                        }
                    } catch (err) {}

                    // Extract visible text for Gemini context
                    setTimeout(() => {
                        try {
                            if (viewerRef.current) {
                                const iframes = viewerRef.current.querySelectorAll('iframe');
                                let text = '';
                                iframes.forEach(iframe => {
                                    try {
                                        text += iframe.contentDocument?.body?.innerText + ' ';
                                    } catch (e) {} // Handle cross-origin if any
                                });
                                if (text.trim().length > 10) {
                                    setCurrentContextText(text.trim());
                                }
                            }
                        } catch (err) {}
                    }, 100);
                } catch (generalError) {
                    console.error("Error in relocated hook:", generalError);
                }
            });
        }
    });
  };

  const nextPage = () => renditionRef.current?.next();
  const prevPage = () => renditionRef.current?.prev();

  const handleGenerate = async () => {
    if (!currentContextText) {
        alert("Please read a few pages first to gather context for the image!");
        return;
    }
    
    setIsLoadingImage(true);
    try {
        const newBg = await generateAmbientImage(currentContextText);
        setBgImage(newBg);
    } catch (e: any) {
        alert("Failed to generate image. Ensure API Key is correct and has quota. " + e.message);
    } finally {
        setIsLoadingImage(false);
    }
  };

  return (
    <>
      {/* Global Background Vibe */}
      <div 
         className="vibe-bg transition-all duration-1000 ease-in-out" 
         aria-hidden="true"
         style={{ backgroundImage: `url(${bgImage})` }}
      ></div>

      {/* Top AppBar */}
      <header className="bg-surface flex justify-between items-center w-full px-4 md:px-12 py-4 md:py-6 max-w-full fixed top-0 z-50">
        <div className="flex flex-col">
          <span className="text-base md:text-xl font-bold tracking-tighter text-on-surface uppercase font-headline">Nocturne</span>
        </div>
        <div className="flex flex-col items-center max-w-[45%] lg:max-w-lg text-center overflow-hidden">
          <span className="text-sm md:text-lg font-bold font-headline text-primary truncate max-w-full block">{bookTitle}</span>
          <span className="text-[10px] md:text-sm font-label text-on-surface-variant uppercase tracking-widest truncate max-w-full block">{chapterTitle}</span>
        </div>
        <div className="flex gap-3 md:gap-6">
          <label className="text-primary hover:bg-surface-container-high transition-colors duration-300 p-2 rounded-lg cursor-pointer">
            <span className="material-symbols-outlined">upload_file</span>
            <input type="file" accept=".epub" className="hidden" onChange={handleFileUpload} />
          </label>
          <button 
             onClick={() => setIsSettingsOpen(true)}
             className="text-primary hover:bg-surface-container-high transition-colors duration-300 p-2 rounded-lg cursor-pointer"
          >
            <span className="material-symbols-outlined">settings</span>
          </button>
        </div>
      </header>

      {/* Main Layout - vertical on mobile, horizontal on lg */}
      <main className="flex flex-col lg:flex-row fixed top-14 md:top-20 bottom-14 md:bottom-20 left-0 right-0 overflow-hidden">

        {/* Cinematic Image Pane — top on mobile, right on desktop */}
        <section className="order-first lg:order-last w-full lg:w-[40%] h-[25vh] lg:h-full relative overflow-hidden atmospheric-glow shrink-0">
          <img 
            key={bgImage}
            alt="Cinematic View" 
            className="absolute inset-0 w-full h-full object-cover opacity-80 animate-in fade-in duration-1000" 
            src={bgImage}
          />
          {/* Gradient: bottom-fade on mobile, left-fade on desktop */}
          <div className="absolute inset-0 bg-gradient-to-b lg:bg-gradient-to-l from-transparent via-surface/20 to-surface"></div>
          
          {/* Generate Button */}
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
             <button 
               onClick={handleGenerate}
               disabled={isLoadingImage || !bookLoaded}
               className="pointer-events-auto flex items-center gap-2 bg-surface-container-high/60 hover:bg-surface-container-high/90 backdrop-blur-md px-4 py-2 md:px-6 md:py-3 rounded-full border border-outline-variant/30 text-on-surface font-headline font-bold uppercase text-xs md:text-base tracking-widest shadow-2xl transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
             >
                <span className="material-symbols-outlined text-base md:text-2xl">{isLoadingImage ? 'hourglass_empty' : 'temp_preferences_custom'}</span>
                {isLoadingImage ? 'Conceiving...' : 'Generate Scene'}
             </button>
          </div>
        </section>

        {/* Reading Pane — bottom on mobile, left on desktop */}
        <section className="order-last lg:order-first w-full lg:w-[60%] flex-1 min-h-0 bg-surface-container-low px-4 md:px-24 py-4 md:py-8 relative">
          <div className="max-w-prose mx-auto absolute inset-0 md:inset-y-8 md:inset-x-24 text-white reading-container overflow-hidden">
             <div ref={viewerRef} className="absolute inset-0 font-body text-base md:text-[1.15rem] leading-[1.7] md:leading-[1.8] text-justify select-none" />
             
             {!bookLoaded && (
                 <div className="absolute inset-0 flex flex-col items-center justify-center text-on-surface-variant z-10 pointer-events-none">
                    <span className="material-symbols-outlined text-5xl md:text-6xl mb-4 opacity-50">auto_stories</span>
                    <p className="font-headline tracking-widest uppercase text-sm md:text-base">Select an EPUB to begin</p>
                 </div>
             )}
          </div>
          {/* Atmospheric blending edge — desktop only */}
          <div className="hidden lg:block absolute top-0 right-0 h-full w-32 bg-gradient-to-r from-transparent to-surface/60 pointer-events-none"></div>
        </section>

      </main>

      {/* BottomNavBar */}
      <footer className="fixed bottom-0 left-0 w-full z-50 h-14 md:h-20 bg-surface-container-low flex justify-between items-center px-4 md:px-12 border-t border-outline-variant/15">
        <button onClick={prevPage} className="flex items-center gap-2 md:gap-3 text-on-surface-variant cursor-pointer hover:text-on-surface transition-colors">
          <div className="w-8 h-8 flex items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container-high">
            <span className="material-symbols-outlined text-sm">keyboard_arrow_left</span>
          </div>
          <span className="text-[10px] font-medium uppercase tracking-widest hidden md:inline">Prev</span>
        </button>
        
        <div className="flex flex-col items-center w-1/2 max-w-md">
           {/* Space reserved for future tools/widgets */}
        </div>
        
        <button onClick={nextPage} className="flex items-center gap-2 md:gap-3 text-on-surface-variant cursor-pointer hover:text-on-surface transition-colors">
          <span className="text-[10px] font-medium uppercase tracking-widest hidden md:inline">Next</span>
          <div className="w-8 h-8 flex items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container-high">
            <span className="material-symbols-outlined text-sm">keyboard_arrow_right</span>
          </div>
        </button>
      </footer>
      
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  );
}
