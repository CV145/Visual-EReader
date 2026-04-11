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

interface GalleryImage {
  id: string;
  base64: string;
  timestamp: number;
  chapter: string;
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
  
  // Visual Novel Mode State
  const [isVnMode, setIsVnMode] = useState(false);
  const [vnParagraphs, setVnParagraphs] = useState<string[]>([]);
  const [activeParagraphIndex, setActiveParagraphIndex] = useState(0);
  const [isVnTextHidden, setIsVnTextHidden] = useState(false);
  const vnTextBoxRef = useRef<HTMLDivElement>(null);
  
  // Font Styling State
  const [fontSize, setFontSize] = useState(100);

  // TOC + Bookmarks + Gallery
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'toc' | 'bookmarks' | 'gallery'>('toc');
  const [tocItems, setTocItems] = useState<any[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [currentCfi, setCurrentCfi] = useState<string>('');
  
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<any>(null);
  const renditionRef = useRef<any>(null);
  
  const lastSpineHrefRef = useRef<string>('');

  const isMountedPhase = useRef(false);
  const isNavigatingBackward = useRef(false);

  const loadSettings = () => {
    setIsVnMode(localStorage.getItem('VN_MODE') === 'true');
  };

  useEffect(() => {
    isMountedPhase.current = true;
    loadSettings();
    // Check locally saved book on load, but prevent double init
    localforage.getItem('savedBook').then((savedBookArrayBuffer) => {
      if (savedBookArrayBuffer && isMountedPhase.current && !bookRef.current) {
        initEpub(savedBookArrayBuffer);
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      // General Navigation
      if (!isVnMode) {
         if (e.key === 'ArrowRight') nextPage();
         if (e.key === 'ArrowLeft') prevPage();
      } else {
         // VN Mode Navigation
         if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
             e.preventDefault();
             advanceVnDialogue();
         }
         if (e.key === 'ArrowLeft') {
             e.preventDefault();
             previousVnDialogue();
         }
         // Custom Scrolling for long dense text
         if (e.key === 'ArrowUp') {
            e.preventDefault();
            vnTextBoxRef.current?.scrollBy({ top: -40, behavior: 'smooth' });
         }
         if (e.key === 'ArrowDown') {
            e.preventDefault();
            vnTextBoxRef.current?.scrollBy({ top: 40, behavior: 'smooth' });
         }
         // Hide UI Toggle
         if (e.key.toLowerCase() === 'h') {
            setIsVnTextHidden(prev => !prev);
         }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // native Gamepad integration (Xbox/ROG Ally)
    let animationFrame: number;
    let lastButtonAPress = false;
    let lastDPadRight = false;
    let lastDPadLeft = false;

    const pollGamepad = () => {
        const gamepads = navigator.getGamepads();
        const gp = gamepads.find(pad => pad !== null);
        if (gp) {
            // Button 0 corresponds to the A button (bottom face button)
            const aPressed = gp.buttons[0]?.pressed;
            // D-Pad Right corresponds to Button 15 natively on standard XInput mapping
            const rightPressed = gp.buttons[15]?.pressed; 

            if (aPressed && !lastButtonAPress) {
                if (isVnMode) advanceVnDialogue();
                else nextPage();
            }
            if (rightPressed && !lastDPadRight) {
                if (isVnMode) advanceVnDialogue();
                else nextPage();
            }
            // Add backwards D-Pad Left mapping (button 14)
            const leftPressed = gp.buttons[14]?.pressed;
            if (leftPressed && !lastDPadLeft) {
                if (isVnMode) previousVnDialogue();
                else prevPage();
            }

            lastButtonAPress = Object.is(aPressed, true);
            lastDPadRight = Object.is(rightPressed, true);
            lastDPadLeft = Object.is(leftPressed, true);
        }
        animationFrame = requestAnimationFrame(pollGamepad);
    };
    animationFrame = requestAnimationFrame(pollGamepad);

    return () => {
       isMountedPhase.current = false;
       window.removeEventListener('keydown', handleKeyDown);
       cancelAnimationFrame(animationFrame);
    };
  }, [isVnMode, vnParagraphs, activeParagraphIndex]);

  const advanceVnDialogue = useCallback(() => {
     if (activeParagraphIndex < vnParagraphs.length - 1) {
         setActiveParagraphIndex(prev => prev + 1);
     } else {
         nextPage();
     }
  }, [activeParagraphIndex, vnParagraphs]);

  const previousVnDialogue = useCallback(() => {
     if (activeParagraphIndex > 0) {
         setActiveParagraphIndex(prev => prev - 1);
     } else {
         isNavigatingBackward.current = true;
         prevPage();
     }
  }, [activeParagraphIndex]);

  // Instantly snap to the top of the newly loaded text box when a paragraph switches organically
  useEffect(() => {
      if (vnTextBoxRef.current) {
          vnTextBoxRef.current.scrollTo({ top: 0, behavior: 'instant' });
      }
  }, [activeParagraphIndex, vnParagraphs]);

  // Re-apply font size when it changes dynamically
  useEffect(() => {
     if (renditionRef.current) {
         renditionRef.current.themes.fontSize(`${fontSize}%`);
     }
  }, [fontSize]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const arrayBuffer = await file.arrayBuffer();
      await localforage.setItem('savedBook', arrayBuffer);
      await localforage.removeItem('epubLocation'); // wipe old location
      await localforage.removeItem('bookmarks'); // wipe old bookmarks
      setBookmarks([]);
      setTocItems([]);
      setGallery([]);
      
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

    // Load gallery for specific book
    bookRef.current.loaded.metadata.then((metadata: any) => {
        const title = metadata.title || 'Unknown Title';
        localforage.getItem(`gallery_${title}`).then((savedGallery) => {
           if (savedGallery) setGallery(savedGallery as GalleryImage[]);
        });
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
            renditionRef.current.themes.fontSize(`${fontSize}%`);
            
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
                    
                    // Update Chapter Title and clear context on major jump
                    try {
                        const spineItem = bookRef.current.spine.get(location.start.cfi);
                        if (spineItem) {
                            if (lastSpineHrefRef.current !== spineItem.href) {
                                lastSpineHrefRef.current = spineItem.href;
                            }

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
                                
                                const chapter = findChapter(toc, spineItem.href);
                                if (chapter) {
                                    setChapterTitle(chapter.label);
                                }
                            }
                        }
                    } catch (err) {}

                    // Extract visible text precisely bounded by CFI
                    setTimeout(() => {
                        try {
                            const startRange = renditionRef.current.getRange(location.start.cfi);
                            const endRange = renditionRef.current.getRange(location.end.cfi);
                            
                            if (startRange && endRange) {
                                const doc = startRange.startContainer.ownerDocument;
                                // Use SHOW_ALL to prevent walker initialization bugs if startContainer is an Element block
                                const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ALL, null);
                                
                                let extractedText = '';
                                const screenParagraphs: string[] = [];
                                let currentParaText = '';
                                let lastBlock: Node | null = null;
                                let pastBoundary = false;
                                const endNode = endRange.startContainer;
                                
                                walker.currentNode = startRange.startContainer;
                                let currentNode: Node | null = walker.currentNode;
                                
                                while (currentNode) {
                                    // Watch for boundary hit
                                    if (currentNode === endNode || (endNode.nodeType === Node.ELEMENT_NODE && endNode.contains(currentNode))) {
                                        pastBoundary = true;
                                    }

                                    // Only extract actual text representation
                                    if (currentNode.nodeType === Node.TEXT_NODE && currentNode.textContent) {
                                        const t = currentNode.textContent;
                                        
                                        if (!pastBoundary) {
                                            const parent = currentNode.parentElement?.closest('p, div, h1, h2, h3, li, blockquote') || currentNode.parentNode;
                                            if (parent !== lastBlock) {
                                                if (currentParaText.trim()) screenParagraphs.push(currentParaText.trim());
                                                currentParaText = '';
                                                lastBlock = parent || null;
                                            }
                                            currentParaText += t + ' ';
                                        }

                                        extractedText += t + ' ';
                                    }
                                    
                                    // Performance optimization: 1500 words averages ~9000 characters. 
                                    // Stop extracting once we securely have enough buffer.
                                    if (extractedText.length > 12000) break;
                                    
                                    currentNode = walker.nextNode();
                                }

                                if (currentParaText.trim() && !pastBoundary) {
                                    screenParagraphs.push(currentParaText.trim());
                                }
                                
                                setVnParagraphs(screenParagraphs);
                                
                                if (isNavigatingBackward.current) {
                                    setActiveParagraphIndex(Math.max(0, screenParagraphs.length - 1));
                                    isNavigatingBackward.current = false;
                                } else {
                                    setActiveParagraphIndex(0);
                                }

                                const cleanedText = extractedText.replace(/\s+/g, ' ').trim();
                                
                                // Slice precisely the first 1500 words (~5 pages) from this exact reading position
                                const words = cleanedText.split(' ');
                                const finalPayload = words.slice(0, 1500).join(' ');

                                if (finalPayload.length > 10) {
                                    setCurrentContextText(finalPayload);
                                }
                            }
                        } catch (err) {
                            console.error("Context Extraction Error:", err);
                        }
                    }, 300);
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

        // Save to Gallery
        const newGalleryItem: GalleryImage = {
            id: Date.now().toString(),
            base64: newBg,
            timestamp: Date.now(),
            chapter: chapterTitle || 'Unknown Chapter'
        };
        const updatedGallery = [newGalleryItem, ...gallery];
        setGallery(updatedGallery);
        await localforage.setItem(`gallery_${bookTitle}`, updatedGallery);

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
          <button
             onClick={() => { setDrawerTab('gallery'); setIsDrawerOpen(true); }}
             title="Image Gallery"
             className="text-primary hover:bg-surface-container-high transition-colors duration-300 p-2 rounded-lg cursor-pointer hidden md:block"
          >
            <span className="material-symbols-outlined">photo_library</span>
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
      {!isVnMode ? (
          <main className="flex flex-col lg:flex-row fixed top-14 md:top-20 bottom-14 md:bottom-20 left-0 right-0 overflow-hidden">
            <section className="order-first lg:order-last w-full lg:w-[40%] h-[25vh] lg:h-full relative overflow-hidden atmospheric-glow shrink-0 group">
              <img 
                key={bgImage}
                alt="Cinematic View" 
                className="absolute inset-0 w-full h-full object-cover opacity-80 animate-in fade-in duration-1000" 
                src={bgImage}
              />
              <div className="absolute inset-0 bg-gradient-to-b lg:bg-gradient-to-l from-transparent via-surface/20 to-surface pointer-events-none"></div>
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
              {isLoadingImage && (
                <div className="absolute inset-0 flex items-center justify-center z-10 bg-surface/30 backdrop-blur-sm pointer-events-none">
                  <span className="material-symbols-outlined text-4xl text-on-surface animate-spin">progress_activity</span>
                </div>
              )}
            </section>
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
              <div className="hidden lg:block absolute top-0 right-0 h-full w-32 bg-gradient-to-r from-transparent to-surface/60 pointer-events-none"></div>
            </section>
          </main>
      ) : (
          <main className="fixed top-14 md:top-20 bottom-14 md:bottom-20 left-0 right-0 z-0 bg-black flex items-center justify-center overflow-hidden">
              <div className="absolute inset-0 bg-contain bg-center bg-no-repeat transition-transform duration-[120s] ease-linear scale-100" style={{ backgroundImage: `url(${bgImage})` }} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />
              <div className="absolute inset-0 p-8 opacity-0 pointer-events-none -z-10" ref={viewerRef}></div>
              {/* Visual Novel UI Overlays */}
              {bookLoaded && (
                  <>
                     <div className="absolute top-4 right-6 z-50 flex gap-4 pointer-events-auto shadow-2xl">
                         <button 
                            onClick={handleGenerate}
                            disabled={isLoadingImage}
                            className="bg-black/90 hover:bg-primary border border-outline-variant/30 text-white rounded-full p-4 shadow-lg flex items-center justify-center cursor-pointer backdrop-blur-md transition-all scale-110 disabled:opacity-60 disabled:cursor-not-allowed"
                            title={isLoadingImage ? "Generating Image..." : "Generate Image"}
                          >
                           {isLoadingImage ? (
                               <span className="material-symbols-outlined animate-spin text-shadow">progress_activity</span>
                           ) : (
                               <span className="material-symbols-outlined text-shadow">magic_button</span>
                           )}
                         </button>
                         <button 
                            onClick={() => setIsVnTextHidden(!isVnTextHidden)}
                            className="bg-black/90 hover:bg-surface-container-high border border-outline-variant/30 text-white rounded-full p-4 shadow-lg flex items-center justify-center cursor-pointer backdrop-blur-md transition-all scale-110"
                            title="Toggle TextBox (H)"
                          >
                           <span className="material-symbols-outlined text-shadow">{isVnTextHidden ? 'visibility_off' : 'visibility'}</span>
                         </button>
                     </div>

                     {!isVnTextHidden && (
                       <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-3xl z-40 bg-black/70 backdrop-blur-md border border-white/10 rounded-xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.6)] flex flex-col transform transition-transform animate-in slide-in-from-bottom-5 h-[30vh]">
                          <div className="flex justify-between items-center mb-4 shrink-0">
                             <span className="text-primary font-label text-sm uppercase tracking-widest px-3 py-1 bg-primary/10 rounded-full border border-primary/20 shadow-inner">{chapterTitle}</span>
                             <span className="text-white/60 text-xs font-mono tracking-widest bg-black/50 px-3 py-1 rounded-full border border-white/5">{activeParagraphIndex + 1} / {vnParagraphs.length || 1}</span>
                          </div>
                          <div ref={vnTextBoxRef} className="flex-1 overflow-y-auto pr-4 custom-scrollbar" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}>
                             <p 
                                className="text-gray-100 font-body leading-[1.8] tracking-wide shadow-none p-1 transition-all duration-300"
                                style={{ fontSize: `${((fontSize / 100) * 1.5).toFixed(2)}rem` }}
                             >
                                 {vnParagraphs.length > 0 ? vnParagraphs[activeParagraphIndex] : "Loading content..."}
                             </p>
                          </div>
                       </div>
                     )}
                  </>
              )}
          </main>
      )}

      {/* BottomNavBar */}
      {/* BottomNavBar */}
      <footer className="fixed bottom-0 left-0 w-full z-50 h-14 md:h-20 bg-surface-container-low flex justify-between items-center px-4 md:px-12 border-t border-outline-variant/15 text-white/90">
        
        {/* Playback & Layout Controls */}
        <div className="flex items-center gap-1 md:gap-6">
          <button 
             onClick={() => { setDrawerTab('toc'); setIsDrawerOpen(true); }}
             className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center hover:bg-surface-variant hover:text-primary rounded-full transition-all cursor-pointer group"
             title="Table of Contents"
          >
             <span className="material-symbols-outlined text-[20px] md:text-2xl group-active:scale-90">format_list_bulleted</span>
          </button>
          
          <button 
             onClick={() => { setDrawerTab('bookmarks'); setIsDrawerOpen(true); }}
             className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center hover:bg-surface-variant hover:text-primary rounded-full transition-all cursor-pointer group"
             title="Bookmarks"
          >
             <span className="material-symbols-outlined text-[20px] md:text-2xl group-active:scale-90">bookmarks</span>
          </button>

          <button 
             onClick={() => { setDrawerTab('gallery'); setIsDrawerOpen(true); }}
             className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center hover:bg-surface-variant hover:text-primary rounded-full transition-all cursor-pointer group"
             title="Generated Gallery"
          >
             <span className="material-symbols-outlined text-[20px] md:text-2xl group-active:scale-90">photo_library</span>
          </button>
        </div>

        {/* Font Controls */}
        <div className="flex items-center gap-2 bg-surface-variant/40 rounded-full px-2 py-1 border border-outline-variant/20 mx-2 md:mx-4">
           <button 
             onClick={() => setFontSize(f => Math.max(50, f - 10))}
             disabled={!bookLoaded}
             className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-variant hover:text-primary transition-all cursor-pointer"
             title="Decrease Font Size"
           >
             <span className="font-label font-bold text-sm select-none">A-</span>
           </button>
           <span className="text-xs font-mono w-10 text-center opacity-70 select-none">{(fontSize / 100).toFixed(1)}x</span>
           <button 
             onClick={() => setFontSize(f => Math.min(250, f + 10))}
             disabled={!bookLoaded}
             className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-variant hover:text-primary transition-all cursor-pointer"
             title="Increase Font Size"
           >
             <span className="font-label font-bold text-sm select-none">A+</span>
           </button>
        </div>

        {/* Global Progress Bar Simulation */}
        <div className="hidden lg:flex flex-1 max-w-xl mx-8 h-1.5 bg-surface-container-high rounded-full overflow-hidden items-center group cursor-pointer" onClick={(e) => {
           // Click to seek simulation
           if (renditionRef.current) {
               const rect = e.currentTarget.getBoundingClientRect();
               const percent = (e.clientX - rect.left) / rect.width;
               // Note: epub.js can't always natively seek by global float percentage reliably depending on book metrics.
               // However, `rendition.display(percent)` functions if locations are generated, or `book.locations.cfiFromPercentage(percent)`
           }
        }}>
           <div className="h-full bg-primary/70 group-hover:bg-primary transition-colors" style={{ width: '0%' }}></div>
        </div>

        {/* Forward & Reverse Overlaid Nav Controls */}
        <div className="flex items-center gap-1 md:gap-4 shrink-0">
          <button 
             onClick={() => prevPage()}
             className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center hover:bg-surface-variant hover:text-primary rounded-full transition-all cursor-pointer group active:bg-primary/20"
          >
             <span className="material-symbols-outlined text-[20px] md:text-3xl font-light transform group-active:-translate-x-1 transition-transform">chevron_left</span>
          </button>
          <button 
             onClick={toggleBookmark}
             disabled={!currentCfi}
             className={`w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full transition-all cursor-pointer group ${isBookmarked ? 'bg-primary text-on-primary' : 'hover:bg-surface-variant hover:text-primary'}`}
          >
             <span className="material-symbols-outlined text-[20px] md:text-2xl group-active:scale-90">{isBookmarked ? 'bookmark_added' : 'bookmark_add'}</span>
          </button>
          <button 
             onClick={() => nextPage()}
             className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center hover:bg-surface-variant hover:text-primary rounded-full transition-all cursor-pointer group active:bg-primary/20"
          >
             <span className="material-symbols-outlined text-[20px] md:text-3xl font-light transform group-active:translate-x-1 transition-transform">chevron_right</span>
          </button>
        </div>
        
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
              <button
                onClick={() => setDrawerTab('gallery')}
                className={`flex-1 pb-3 text-sm font-label font-bold uppercase tracking-widest text-center transition-colors cursor-pointer ${
                  drawerTab === 'gallery' ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Gallery
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

              {drawerTab === 'gallery' && (
                <div className="grid grid-cols-2 gap-3 p-2">
                  {gallery.length === 0 && (
                    <div className="col-span-2 text-on-surface-variant text-sm text-center py-8">
                       No images generated for this book yet.<br/>Click the sparkle button overlay to visualize a scene!
                    </div>
                  )}
                  {gallery.map((img) => (
                    <div key={img.id} className="flex flex-col gap-1 group relative">
                      <div 
                         className="aspect-video w-full rounded-lg overflow-hidden border border-outline-variant/30 cursor-pointer hover:border-primary transition-colors flex bg-surface-container-highest items-center justify-center relative"
                         onClick={() => { setBgImage(img.base64); setIsExpanded(true); setIsDrawerOpen(false); }}
                      >
                         <img src={img.base64} alt={img.chapter} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                         <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                            <span className="material-symbols-outlined text-3xl">fullscreen</span>
                         </div>
                      </div>
                      <span className="text-[10px] text-on-surface-variant font-label truncate px-1 text-center font-bold">{img.chapter}</span>
                      <span className="text-[9px] text-on-surface-variant/70 text-center uppercase tracking-wider">{new Date(img.timestamp).toLocaleDateString()}</span>
                      <button
                        onClick={async (e) => {
                           e.stopPropagation();
                           const up = gallery.filter(g => g.id !== img.id);
                           setGallery(up);
                           await localforage.setItem(`gallery_${bookTitle}`, up);
                        }}
                        className="absolute top-1 right-1 bg-surface/80 hover:bg-red-500/80 hover:text-white text-on-surface-variant rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer backdrop-blur-sm"
                        title="Delete Image"
                      >
                         <span className="material-symbols-outlined text-xs">close</span>
                      </button>
                    </div>
                  ))}
                </div>
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
