import React, { useState, useEffect, useRef, useCallback } from 'react';
import ePub from 'epubjs';
import localforage from 'localforage';
import { SettingsModal } from './SettingsModal';
import { generateAmbientImage } from './gemini';

interface Bookmark {
  cfi: string;
  label: string;
  timestamp: number;
}

export default function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [bookTitle, setBookTitle] = useState('NOCTURNE READER');
  const [chapterTitle, setChapterTitle] = useState('Welcome');
  const [bookLoaded, setBookLoaded] = useState(false);
  const [bgImage, setBgImage] = useState('https://lh3.googleusercontent.com/aida-public/AB6AXuBd5IsdtuXAefa1sVo5e0KSQOMgbc-FQHAE7KUQX1EnW6K8GRXOzBDNJn-U2nqluHhiNQOFPMCYjkNqdcTGiV-menxkJbW5T8HVMi2qalHeVEdy9mbVGLL-ESF0tp7wbf80Wyo47iImNnXPfgNfpKZt7V7TNSBGaTKZRlCHtkqfI1z2kH86RiaPLdWeCFELkpNVnEODNuQfWvEgKbfJuEDAkijghFuxBb--aNKMhFgDNG4-rR80RXhUp9X3YYAPpxnkYVUbWCvX1s5f');
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [currentContextText, setCurrentContextText] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  // TOC + Bookmarks
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'toc' | 'bookmarks'>('toc');
  const [tocItems, setTocItems] = useState<any[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [currentCfi, setCurrentCfi] = useState<string>('');
  
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<any>(null);
  const renditionRef = useRef<any>(null);

  const isMountedPhase = useRef(false);

  useEffect(() => {
    isMountedPhase.current = true;
    // Check locally saved book on load, but prevent double init
    localforage.getItem('savedBook').then((savedBookArrayBuffer) => {
      if (savedBookArrayBuffer && isMountedPhase.current && !bookRef.current) {
        initEpub(savedBookArrayBuffer);
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') nextPage();
      if (e.key === 'ArrowLeft') prevPage();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
       isMountedPhase.current = false;
       window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const arrayBuffer = await file.arrayBuffer();
      await localforage.setItem('savedBook', arrayBuffer);
      await localforage.removeItem('epubLocation'); // wipe old location
      await localforage.removeItem('bookmarks'); // wipe old bookmarks
      setBookmarks([]);
      setTocItems([]);
      
      // Cleanup previous rendition if exists
      if (renditionRef.current) renditionRef.current.destroy();
      if (bookRef.current) bookRef.current.destroy();
      bookRef.current = null;
      
      initEpub(arrayBuffer);
    }
  };

  const initEpub = (bookData: ArrayBuffer | string) => {
    if (bookRef.current) return; // Prevent dual initialization
    bookRef.current = ePub(bookData as any);
    
    bookRef.current.loaded.metadata.then((metadata: any) => {
      setBookTitle(metadata.title || 'Unknown Title');
    });

    // Load TOC
    bookRef.current.loaded.navigation.then((nav: any) => {
        if (nav?.toc) setTocItems(nav.toc);
    });

    // Load saved bookmarks
    localforage.getItem('bookmarks').then((saved) => {
        if (saved) setBookmarks(saved as Bookmark[]);
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
            
            // Try to load last location, fallback to cover if corrupted
            localforage.getItem('epubLocation').then((loc) => {
               if (loc) {
                   renditionRef.current.display(loc as string).catch(() => {
                       renditionRef.current.display(); 
                   });
               } else {
                   renditionRef.current.display();
               }
            }).catch(() => {
                renditionRef.current.display();
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
                    setCurrentCfi(location.start.cfi);
                    
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

  const navigateToHref = (href: string) => {
    renditionRef.current?.display(href);
    setIsDrawerOpen(false);
  };

  const navigateToCfi = (cfi: string) => {
    renditionRef.current?.display(cfi);
    setIsDrawerOpen(false);
  };

  const addBookmark = async () => {
    if (!currentCfi) return;
    const alreadyExists = bookmarks.some(b => b.cfi === currentCfi);
    if (alreadyExists) return;
    const newBookmark: Bookmark = {
      cfi: currentCfi,
      label: chapterTitle || 'Unknown location',
      timestamp: Date.now()
    };
    const updated = [...bookmarks, newBookmark];
    setBookmarks(updated);
    await localforage.setItem('bookmarks', updated);
  };

  const removeBookmark = async (cfi: string) => {
    const updated = bookmarks.filter(b => b.cfi !== cfi);
    setBookmarks(updated);
    await localforage.setItem('bookmarks', updated);
  };

  const isCurrentPageBookmarked = bookmarks.some(b => b.cfi === currentCfi);

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
        <div className="flex gap-2 md:gap-4">
          <button
             onClick={() => { setDrawerTab('toc'); setIsDrawerOpen(true); }}
             title="Table of Contents"
             className="text-primary hover:bg-surface-container-high transition-colors duration-300 p-2 rounded-lg cursor-pointer"
          >
            <span className="material-symbols-outlined">menu_book</span>
          </button>
          <button
             onClick={() => { setDrawerTab('bookmarks'); setIsDrawerOpen(true); }}
             title="Bookmarks"
             className="text-primary hover:bg-surface-container-high transition-colors duration-300 p-2 rounded-lg cursor-pointer"
          >
            <span className="material-symbols-outlined">bookmarks</span>
          </button>
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
        <section className="order-first lg:order-last w-full lg:w-[40%] h-[25vh] lg:h-full relative overflow-hidden atmospheric-glow shrink-0 group">
          <img 
            key={bgImage}
            alt="Cinematic View" 
            className="absolute inset-0 w-full h-full object-cover opacity-80 animate-in fade-in duration-1000" 
            src={bgImage}
          />
          {/* Gradient: bottom-fade on mobile, left-fade on desktop */}
          <div className="absolute inset-0 bg-gradient-to-b lg:bg-gradient-to-l from-transparent via-surface/20 to-surface pointer-events-none"></div>
          
          {/* Corner Action Buttons — appear subtly on hover */}
          <div className="absolute bottom-3 right-3 z-20 flex gap-2 opacity-60 group-hover:opacity-100 transition-opacity duration-300">
             <button 
               onClick={handleGenerate}
               disabled={isLoadingImage || !bookLoaded}
               title={isLoadingImage ? 'Generating...' : 'Generate Scene'}
               className="w-9 h-9 flex items-center justify-center bg-surface/70 hover:bg-surface/90 backdrop-blur-md rounded-lg border border-outline-variant/30 text-on-surface shadow-lg transition-all hover:scale-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
             >
                <span className="material-symbols-outlined text-lg">{isLoadingImage ? 'hourglass_empty' : 'auto_awesome'}</span>
             </button>
             <button 
               onClick={() => setIsExpanded(true)}
               title="Expand Image"
               className="w-9 h-9 flex items-center justify-center bg-surface/70 hover:bg-surface/90 backdrop-blur-md rounded-lg border border-outline-variant/30 text-on-surface shadow-lg transition-all hover:scale-110 active:scale-95 cursor-pointer"
             >
                <span className="material-symbols-outlined text-lg">fullscreen</span>
             </button>
          </div>

          {/* Loading spinner overlay */}
          {isLoadingImage && (
            <div className="absolute inset-0 flex items-center justify-center z-10 bg-surface/30 backdrop-blur-sm pointer-events-none">
              <span className="material-symbols-outlined text-4xl text-on-surface animate-spin">progress_activity</span>
            </div>
          )}
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
        
        <div className="flex items-center justify-center">
          <button
            onClick={addBookmark}
            disabled={!bookLoaded || isCurrentPageBookmarked}
            title={isCurrentPageBookmarked ? 'Page bookmarked' : 'Bookmark this page'}
            className="flex items-center gap-2 text-on-surface-variant hover:text-primary cursor-pointer transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-xl">
              {isCurrentPageBookmarked ? 'bookmark_added' : 'bookmark_add'}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-widest hidden md:inline">
              {isCurrentPageBookmarked ? 'Saved' : 'Bookmark'}
            </span>
          </button>
        </div>
        
        <button onClick={nextPage} className="flex items-center gap-2 md:gap-3 text-on-surface-variant cursor-pointer hover:text-on-surface transition-colors">
          <span className="text-[10px] font-medium uppercase tracking-widest hidden md:inline">Next</span>
          <div className="w-8 h-8 flex items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container-high">
            <span className="material-symbols-outlined text-sm">keyboard_arrow_right</span>
          </div>
        </button>
      </footer>
      
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* TOC / Bookmarks Drawer */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-[150] flex">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setIsDrawerOpen(false)}></div>
          
          {/* Drawer Panel */}
          <div className="relative w-[85vw] max-w-sm h-full bg-surface-container-high border-r border-outline-variant/20 shadow-2xl flex flex-col animate-in slide-in-from-left duration-300 overflow-hidden">
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="text-lg font-headline font-bold text-on-surface uppercase tracking-wider">
                {drawerTab === 'toc' ? 'Contents' : 'Bookmarks'}
              </h2>
              <button onClick={() => setIsDrawerOpen(false)} className="text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-outline-variant/20 px-5">
              <button
                onClick={() => setDrawerTab('toc')}
                className={`flex-1 pb-3 text-sm font-label font-bold uppercase tracking-widest text-center transition-colors cursor-pointer ${
                  drawerTab === 'toc' ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Chapters
              </button>
              <button
                onClick={() => setDrawerTab('bookmarks')}
                className={`flex-1 pb-3 text-sm font-label font-bold uppercase tracking-widest text-center transition-colors cursor-pointer ${
                  drawerTab === 'bookmarks' ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Bookmarks
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-2 py-3">
              {drawerTab === 'toc' && (
                <ul className="space-y-0.5">
                  {tocItems.length === 0 && (
                    <li className="text-on-surface-variant text-sm text-center py-8">No table of contents available.</li>
                  )}
                  {tocItems.map((item: any, idx: number) => (
                    <React.Fragment key={idx}>
                      <li>
                        <button
                          onClick={() => navigateToHref(item.href)}
                          className="w-full text-left px-3 py-2.5 rounded-lg text-on-surface hover:bg-surface-container-highest hover:text-primary transition-colors text-sm font-body cursor-pointer truncate"
                        >
                          {item.label?.trim()}
                        </button>
                      </li>
                      {item.subitems?.map((sub: any, subIdx: number) => (
                        <li key={`${idx}-${subIdx}`}>
                          <button
                            onClick={() => navigateToHref(sub.href)}
                            className="w-full text-left pl-8 pr-3 py-2 rounded-lg text-on-surface-variant hover:bg-surface-container-highest hover:text-primary transition-colors text-xs font-body cursor-pointer truncate"
                          >
                            {sub.label?.trim()}
                          </button>
                        </li>
                      ))}
                    </React.Fragment>
                  ))}
                </ul>
              )}

              {drawerTab === 'bookmarks' && (
                <ul className="space-y-1">
                  {bookmarks.length === 0 && (
                    <li className="text-on-surface-variant text-sm text-center py-8">No bookmarks yet.<br/>Use the bookmark button at the bottom to save your place.</li>
                  )}
                  {bookmarks.map((bm, idx) => (
                    <li key={idx} className="flex items-center gap-2 group">
                      <button
                        onClick={() => navigateToCfi(bm.cfi)}
                        className="flex-1 text-left px-3 py-2.5 rounded-lg text-on-surface hover:bg-surface-container-highest hover:text-primary transition-colors cursor-pointer truncate"
                      >
                        <span className="text-sm font-body block truncate">{bm.label}</span>
                        <span className="text-[10px] text-on-surface-variant font-label">
                          {new Date(bm.timestamp).toLocaleDateString()} {new Date(bm.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                      </button>
                      <button
                        onClick={() => removeBookmark(bm.cfi)}
                        title="Remove bookmark"
                        className="opacity-0 group-hover:opacity-100 text-on-surface-variant hover:text-red-400 transition-all p-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Image Overlay */}
      {isExpanded && (
        <div 
          className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-lg flex items-center justify-center cursor-pointer"
          onClick={() => setIsExpanded(false)}
        >
          <img 
            src={bgImage} 
            alt="Expanded Cinematic View" 
            className="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl animate-in fade-in zoom-in-95 duration-300"
          />
          <button 
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center bg-surface/50 hover:bg-surface/80 backdrop-blur-md rounded-full text-on-surface transition-all cursor-pointer"
            onClick={() => setIsExpanded(false)}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      )}
    </>
  );
}
