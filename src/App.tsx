import React, { useState, useEffect, useRef, useCallback } from 'react';
import ePub from 'epubjs';
import { SettingsModal } from './SettingsModal';
import { LocalImageEngine } from './imageEngine';
import { generateAmbientImage, analyzeMusicalSentiment, extractCharacterProfiles, detectOverallGenre } from './gemini';
import { LyriaEngine } from './lyriaEngine';
import {initLocalLLM, summarizeTextLocally} from './lyriaEngine';
import LibraryPage from './LibraryPage';
import {
  BookMeta, Bookmark, GalleryImage, CharacterProfile,
  getLibrary, loadBookFile, addBookToLibrary,
  loadLocation, saveLocation,
  loadBookmarks, saveBookmarks,
  loadGallery, saveGallery,
  loadCharacters, saveCharacters, upsertCharacter,
} from './db';

interface VnParagraph {
  text: string;
  cfi: string;
  html?: string;
}

export function SummarizerMVP({ paragraphs }: { paragraphs: string[] }) {
  const [loadingMsg, setLoadingMsg] = useState("");
  const [summary, setSummary] = useState("");
  const [isSummarizing, setIsSummarizing] = useState(false);

  const handleSummarize = async () => {
    setIsSummarizing(true);
    try {
      setLoadingMsg("Loading AI Engine...");
      await initLocalLLM((report) => {
        setLoadingMsg(`Loading Model: ${report.text}`);
      });

      const textToSummarize = paragraphs.slice(0, 20).join("\n\n");
      
      setLoadingMsg("Summarizing...");
      const result = await summarizeTextLocally(textToSummarize);
      setSummary(result);
      
    } catch (error) {
      console.error(error);
      setSummary("Error generating summary. Check console.");
    } finally {
      setLoadingMsg("");
      setIsSummarizing(false);
    }
  };

  return (
    <div className="p-4 bg-gray-800/90 backdrop-blur-md text-white rounded-lg border border-outline-variant/30 shadow-2xl">
      <button 
        onClick={handleSummarize} 
        disabled={isSummarizing || paragraphs.length === 0}
        className="w-full bg-primary/20 hover:bg-primary text-primary hover:text-on-primary border border-primary/50 px-4 py-2 rounded transition-colors disabled:opacity-50 font-bold uppercase tracking-wider text-sm cursor-pointer"
      >
        {isSummarizing ? "Processing..." : "Summarize Next 20 Paras (Local)"}
      </button>

      {loadingMsg && <p className="mt-2 text-xs text-yellow-400 font-mono">{loadingMsg}</p>}
      
      {summary && (
        <div className="mt-4 p-3 bg-surface-container-highest rounded border border-outline-variant/20 max-h-60 overflow-y-auto">
          <h3 className="font-bold text-sm uppercase tracking-widest mb-2 text-primary">Local Summary</h3>
          <p className="whitespace-pre-wrap text-sm font-body leading-relaxed">{summary}</p>
        </div>
      )}
    </div>
  );
}

export default function App() {
  // ─── Router State ─────────────────────────────────────────────────────────
  const [activeBook, setActiveBook] = useState<BookMeta | null>(null);

  // ─── UI State ─────────────────────────────────────────────────────────────
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [bookTitle, setBookTitle] = useState('');
  const [chapterTitle, setChapterTitle] = useState('');
  const [bookLoaded, setBookLoaded] = useState(false);
  const [bgImage, setBgImage] = useState('https://lh3.googleusercontent.com/aida-public/AB6AXuBd5IsdtuXAefa1sVo5e0KSQOMgbc-FQHAE7KUQX1EnW6K8GRXOzBDNJn-U2nqluHhiNQOFPMCYjkNqdcTGiV-menxkJbW5T8HVMi2qalHeVEdy9mbVGLL-ESF0tp7wbf80Wyo47iImNnXPfgNfpKZt7V7TNSBGaTKZRlCHtkqfI1z2kH86RiaPLdWeCFELkpNVnEODNuQfWvEgKbfJuEDAkijghFuxBb--aNKMhFgDNG4-rR80RXhUp9X3YYAPpxnkYVUbWCvX1s5f');
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [currentContextText, setCurrentContextText] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [isTtsEnabled, setIsTtsEnabled] = useState(false);
  const [currentAudioPrompt, setCurrentAudioPrompt] = useState('');
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [showSafetyPopup, setShowSafetyPopup] = useState(false);
  const [sceneCharacters, setSceneCharacters] = useState<string[]>([]);
  const localImageRef = useRef<LocalImageEngine | null>(null);
  const [imageLoadingMsg, setImageLoadingMsg] = useState('');
  //const [isGeneratingPortraits, setIsGeneratingPortraits] = useState(false);
  const [ttsSpeed, setTtsSpeed] = useState(() => {
    const saved = localStorage.getItem('TTS_SPEED');
    return saved ? parseFloat(saved) : 1.0;
  });

  // ─── VN State ─────────────────────────────────────────────────────────────
  const [isStretchImage, setIsStretchImage] = useState(false);
  const [vnParagraphs, setVnParagraphs] = useState<VnParagraph[]>([]);
  const [activeParagraphIndex, setActiveParagraphIndex] = useState(0);
  const [isVnTextHidden, setIsVnTextHidden] = useState(false);
  const vnTextBoxRef = useRef<HTMLDivElement>(null);

  // ─── Font ─────────────────────────────────────────────────────────────────
  const [fontSize, setFontSizeState] = useState(100);
  const setFontSize = (size: number | ((s: number) => number)) => {
    setFontSizeState(prev => {
      const newSize = typeof size === 'function' ? size(prev) : size;
      localStorage.setItem('FONT_SIZE', newSize.toString());
      return newSize;
    });
  };

  // ─── Drawer ───────────────────────────────────────────────────────────────
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'toc' | 'bookmarks' | 'gallery' | 'characters' | 'genre'>('toc');
  const [tocItems, setTocItems] = useState<any[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [currentCfi, setCurrentCfi] = useState<string>('');
  const [expandedCharacter, setExpandedCharacter] = useState<string | null>(null);

  // ─── Refs ─────────────────────────────────────────────────────────────────
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<any>(null);
  const renditionRef = useRef<any>(null);
  const lyriaRef = useRef<LyriaEngine | null>(null);
  const lastSpineHrefRef = useRef<string>('');
  const isMountedPhase = useRef(false);
  const isNavigatingBackward = useRef(false);
  const isInternalVnNavigation = useRef(false);
  const pendingTocHref = useRef<string | null>(null);
  const pendingCfi = useRef<string | null>(null);
  const pendingBookmarkIndex = useRef<number | null>(null);
  const hasAutoResumed = useRef(false);

  // ─── Settings Load ────────────────────────────────────────────────────────
  const loadSettings = () => {
    setIsStretchImage(localStorage.getItem('STRETCH_IMAGE') === 'true');
    const savedFontSize = localStorage.getItem('FONT_SIZE');
    if (savedFontSize) setFontSizeState(parseInt(savedFontSize, 10));
  };

  // ─── Open Book from Library ───────────────────────────────────────────────
  const openBook = useCallback(async (book: BookMeta) => {
    // Cleanup any existing reader state
    if (renditionRef.current) { renditionRef.current.destroy(); renditionRef.current = null; }
    if (bookRef.current) { bookRef.current.destroy(); bookRef.current = null; }
    lyriaRef.current?.stop?.();
    lyriaRef.current = null;
    setIsMusicPlaying(false);
    setBookLoaded(false);
    setVnParagraphs([]);
    setActiveParagraphIndex(0);
    setTocItems([]);
    setBookmarks([]);
    setGallery([]);
    setCharacters([]);
    lastSpineHrefRef.current = '';

    setActiveBook(book);
    setBookTitle(book.title);

    // Load per-book data
    const [bms, gallery, chars] = await Promise.all([
      loadBookmarks(book.id),
      loadGallery(book.id),
      loadCharacters(book.id),
    ]);
    setBookmarks(bms);
    setGallery(gallery);
    setCharacters(chars);
    if (gallery.length > 0) setBgImage(gallery[0].base64);

    const data = await loadBookFile(book.id);
    if (data) {
      initEpub(data, book.id);
    }
  }, []);

  // ─── Auto-Resume (runs exactly once on mount) ─────────────────────────────
  useEffect(() => {
    if (hasAutoResumed.current) return;
    hasAutoResumed.current = true;
    getLibrary().then(lib => {
      if (lib.length > 0) {
        const lastRead = [...lib].sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))[0];
        if (lastRead && lastRead.lastOpenedAt > 0) {
           openBook(lastRead);
        }
      }
    });
  }, []);

  // ─── Mount Effect (keyboard + gamepad) ────────────────────────────────────
  useEffect(() => {
    isMountedPhase.current = true;
    loadSettings();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advanceVnDialogue(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); previousVnDialogue(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); vnTextBoxRef.current?.scrollBy({ top: -40, behavior: 'smooth' }); }
      if (e.key === 'ArrowDown') { e.preventDefault(); vnTextBoxRef.current?.scrollBy({ top: 40, behavior: 'smooth' }); }
      if (e.key.toLowerCase() === 'h') setIsVnTextHidden(prev => !prev);
    };
    window.addEventListener('keydown', handleKeyDown);

    let animationFrame: number;
    let lastButtonAPress = false, lastDPadRight = false, lastDPadLeft = false;
    const pollGamepad = () => {
      const gp = navigator.getGamepads().find(p => p !== null);
      if (gp) {
        const aPressed = gp.buttons[0]?.pressed;
        const rightPressed = gp.buttons[15]?.pressed;
        const leftPressed = gp.buttons[14]?.pressed;
        if (aPressed && !lastButtonAPress) advanceVnDialogue();
        if (rightPressed && !lastDPadRight) advanceVnDialogue();
        if (leftPressed && !lastDPadLeft) previousVnDialogue();
        lastButtonAPress = !!aPressed; lastDPadRight = !!rightPressed; lastDPadLeft = !!leftPressed;
      }
      animationFrame = requestAnimationFrame(pollGamepad);
    };
    animationFrame = requestAnimationFrame(pollGamepad);

    return () => {
      isMountedPhase.current = false;
      window.removeEventListener('keydown', handleKeyDown);
      cancelAnimationFrame(animationFrame);
    };
  }, [vnParagraphs, activeParagraphIndex]);

  // ─── VN Navigation ────────────────────────────────────────────────────────
  const advanceVnDialogue = useCallback(() => {
    if (activeParagraphIndex < vnParagraphs.length - 1) {
      const nextIndex = activeParagraphIndex + 1;
      setActiveParagraphIndex(nextIndex);
      isInternalVnNavigation.current = true;
      renditionRef.current?.display(vnParagraphs[nextIndex].cfi);
    } else {
      try {
        const currentSection = bookRef.current.spine.get(lastSpineHrefRef.current);
        if (currentSection && currentSection.index < bookRef.current.spine.length - 1) {
          renditionRef.current?.display(bookRef.current.spine.get(currentSection.index + 1).href);
        }
      } catch(e) {}
    }
  }, [activeParagraphIndex, vnParagraphs]);

  const previousVnDialogue = useCallback(() => {
    if (activeParagraphIndex > 0) {
      const prevIndex = activeParagraphIndex - 1;
      setActiveParagraphIndex(prevIndex);
      isInternalVnNavigation.current = true;
      renditionRef.current?.display(vnParagraphs[prevIndex].cfi);
    } else {
      try {
        const currentSection = bookRef.current.spine.get(lastSpineHrefRef.current);
        if (currentSection && currentSection.index > 0) {
          isNavigatingBackward.current = true;
          renditionRef.current?.display(bookRef.current.spine.get(currentSection.index - 1).href);
        }
      } catch(e) { isNavigatingBackward.current = true; }
    }
  }, [activeParagraphIndex, vnParagraphs]);

  // ─── Paragraph Index Effect (Context / Music / TTS) ───────────────────────
  useEffect(() => {
    if (vnTextBoxRef.current) vnTextBoxRef.current.scrollTo({ top: 0, behavior: 'smooth' });

    if (vnParagraphs.length > 0 && activeParagraphIndex >= 0) {
      const activeNode = vnParagraphs[activeParagraphIndex];
      if (activeNode && activeBook) {
        setCurrentCfi(activeNode.cfi);
        saveLocation(activeBook.id, activeNode.cfi);
      }

      const sliceAhead = vnParagraphs.slice(activeParagraphIndex, activeParagraphIndex + 20);
      const rawText = sliceAhead.map((p: any) => p.text).join(' ');
      const finalPayload = rawText.split(' ').slice(0, 5000).join(' ');
      if (finalPayload.length > 10) {
        setCurrentContextText(finalPayload);
        if (activeParagraphIndex % 3 === 0) {
          console.log(`🎵 P${activeParagraphIndex}: music check — playing=${isMusicPlaying}, session=${!!lyriaRef.current}, genre="${activeBook?.anchorGenre}"`);
          if (isMusicPlaying && lyriaRef.current) {
            const genre = activeBook?.anchorGenre || 'cinematic instrumental';
            analyzeMusicalSentiment(finalPayload, genre).then((sentiment) => {
              console.log(`🎵 Sentiment: "${sentiment}"`);

              setCurrentAudioPrompt(sentiment);

              if (lyriaRef.current && isMusicPlaying) lyriaRef.current.setPrompts(sentiment);
            });
          }
        }
      }

      // TTS: speak paragraph text
      if (isTtsEnabled && activeNode) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(activeNode.text);
        utter.rate = ttsSpeed;
        utter.pitch = 1.0;
        window.speechSynthesis.speak(utter);
      }
    }
  }, [activeParagraphIndex, vnParagraphs, isMusicPlaying, isTtsEnabled, activeBook]);

  // ─── Passive Scene Character Detection ────────────────────────────────────
  // No AI — simple name-match per paragraph. Fast and free.
  useEffect(() => {
    if (vnParagraphs.length === 0 || characters.length === 0) {
      setSceneCharacters([]);
      return;
    }
    const currentText = vnParagraphs[activeParagraphIndex]?.text || '';
    const lowerText = currentText.toLowerCase();
    const present = characters
      .filter(c => lowerText.includes(c.name.toLowerCase()))
      .map(c => c.name);
    setSceneCharacters(present);
  }, [activeParagraphIndex, vnParagraphs, characters]);

  // ─── Font size effect ─────────────────────────────────────────────────────
  useEffect(() => {
    if (renditionRef.current) renditionRef.current.themes.fontSize(`${fontSize}%`);
  }, [fontSize]);

  // ─── initEpub ─────────────────────────────────────────────────────────────
  const initEpub = (bookData: ArrayBuffer, bookId: string) => {
    if (bookRef.current) return;
    bookRef.current = ePub(bookData as any);

    bookRef.current.loaded.metadata.then((metadata: any) => {
      setBookTitle(metadata.title || 'Unknown Title');
    });

    bookRef.current.loaded.navigation.then((nav: any) => {
      if (nav?.toc) setTocItems(nav.toc);
    });

    bookRef.current.ready.then(() => {
      setBookLoaded(true);
      if (viewerRef.current) {
        renditionRef.current = bookRef.current.renderTo(viewerRef.current, {
          width: '100%', height: '100%', manager: 'continuous', flow: 'scrolled-doc', spread: 'none', snap: true
        });

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

        loadLocation(bookId).then((loc) => {
          if (loc) renditionRef.current.display(loc).catch(() => renditionRef.current.display());
          else renditionRef.current.display();
        }).catch(() => renditionRef.current.display());

        renditionRef.current.on('relocated', (location: any) => {
          try {
            if (!location?.start?.cfi) return;
            saveLocation(bookId, location.start.cfi);
            setCurrentCfi(location.start.cfi);

            try {
              const spineItem = bookRef.current.spine.get(location.start.cfi);
              if (spineItem) {
                const toc = bookRef.current.navigation?.toc;
                if (toc?.length > 0) {
                  const findChapter = (items: any[], href: string): any => {
                    for (const item of items) {
                      if (href.includes(item.href)) return item;
                      if (item.subitems) { const sub = findChapter(item.subitems, href); if (sub) return sub; }
                    }
                    return null;
                  };
                  const chapter = findChapter(toc, spineItem.href);
                  if (chapter) setChapterTitle(chapter.label);
                }

                if (isInternalVnNavigation.current) { isInternalVnNavigation.current = false; return; }

                setTimeout(() => {
                  try {
                    const startRange = renditionRef.current.getRange(location.start.cfi);
                    if (!startRange) return;
                    const activeDoc = startRange.startContainer.ownerDocument;
                    const allContents = renditionRef.current.getContents() || [];
                    const correctContents = allContents.find((c: any) => c.document === activeDoc) || allContents[0];
                    if (!correctContents || !activeDoc) return;

                    let targetElement: Node | null = null;
                    let forcedIndex: number | null = null;

                    if (pendingTocHref.current) {
                      const hashSplit = pendingTocHref.current.split('#');
                      const anchorId = hashSplit.length > 1 ? hashSplit[1] : null;
                      if (anchorId) {
                        const explicitNode = activeDoc.querySelector(`[id="${anchorId}"], a[name="${anchorId}"]`);
                        if (explicitNode) targetElement = explicitNode; else forcedIndex = 0;
                      } else forcedIndex = 0;
                      pendingTocHref.current = null;
                    }
                    if (!targetElement && forcedIndex === null && !pendingCfi.current) forcedIndex = 0;

                    const rawElements = activeDoc.body.querySelectorAll('p, blockquote, li, h1, h2, h3');

                    const resolveTargetIndex = (graphRef: VnParagraph[]) => {
                      if (pendingCfi.current) {
                        const explicitIdx = pendingBookmarkIndex.current;
                        pendingCfi.current = null; pendingBookmarkIndex.current = null;
                        if (explicitIdx !== null && explicitIdx !== undefined) {
                          const mappedIdx = explicitIdx - 1;
                          if (mappedIdx >= 0 && mappedIdx < graphRef.length) return mappedIdx;
                        }
                        return 0;
                      }
                      if (forcedIndex !== null) return forcedIndex;
                      if (!targetElement) return 0;
                      let matchedIdx = 0, found = false, idxCount = 0;
                      rawElements.forEach(el => {
                        const txt = el.textContent?.trim();
                        if (txt && txt.length > 5) {
                          if (!found) {
                            if (el === targetElement || el.contains(targetElement)) { matchedIdx = idxCount; found = true; }
                            else {
                              const pos = el.compareDocumentPosition(targetElement as Node);
                              if (pos & Node.DOCUMENT_POSITION_PRECEDING) { matchedIdx = idxCount; found = true; }
                            }
                          }
                          idxCount++;
                        }
                      });
                      return matchedIdx;
                    };

                    if (lastSpineHrefRef.current !== spineItem.href || vnParagraphs.length === 0) {
                      lastSpineHrefRef.current = spineItem.href;
                      const chapterGraph: VnParagraph[] = [];
                      rawElements.forEach(element => {
                        const txt = element.textContent?.trim();
                        if (txt && txt.length > 5) {
                          const nativeCfi = correctContents.cfiFromNode(element);
                          if (nativeCfi) {
                            // Safely grab the raw HTML without forcing a layout recalculation
                            chapterGraph.push({ 
                                text: txt, 
                                cfi: nativeCfi, 
                                html: element.innerHTML 
                            });
                          }
                        }
                      });
                      if (chapterGraph.length > 0) {
                        setVnParagraphs(chapterGraph);
                        if (isNavigatingBackward.current) {
                          const extremeIdx = chapterGraph.length - 1;
                          setActiveParagraphIndex(extremeIdx);
                          isInternalVnNavigation.current = true;
                          renditionRef.current.display(chapterGraph[extremeIdx].cfi);
                          isNavigatingBackward.current = false;
                        } else {
                          const finalIdx = resolveTargetIndex(chapterGraph);
                          setActiveParagraphIndex(finalIdx);
                          if (finalIdx > 0 && chapterGraph[finalIdx]) {
                            isInternalVnNavigation.current = true;
                            renditionRef.current.display(chapterGraph[finalIdx].cfi);
                          }
                        }
                      }
                    } else {
                      const finalIdx = resolveTargetIndex(vnParagraphs);
                      setActiveParagraphIndex(finalIdx);
                      if (finalIdx > 0 && vnParagraphs[finalIdx]) {
                        isInternalVnNavigation.current = true;
                        renditionRef.current.display(vnParagraphs[finalIdx].cfi);
                      }
                    }
                  } catch (err) { console.error("Chapter Extraction Error:", err); }
                }, 100);
              }
            } catch (err) {}
          } catch (generalError) { console.error("Error in relocated hook:", generalError); }
        });
      }
    });
  };

  // ─── Navigation helpers ───────────────────────────────────────────────────
  const nextPage = advanceVnDialogue;
  const prevPage = previousVnDialogue;

  const navigateToHref = (href: string) => {
    pendingTocHref.current = href;
    renditionRef.current?.display(href);
    setIsDrawerOpen(false);
  };

  const navigateToBookmark = (bm: Bookmark) => {
    pendingCfi.current = bm.cfi;
    pendingBookmarkIndex.current = bm.paragraphIndex ?? null;
    renditionRef.current?.display(bm.cfi);
    setIsDrawerOpen(false);
  };

  // ─── Bookmarks ────────────────────────────────────────────────────────────
  const addBookmark = async () => {
    if (!currentCfi || !activeBook) return;
    if (bookmarks.some(b => b.cfi === currentCfi)) return;
    const newBm: Bookmark = { cfi: currentCfi, label: chapterTitle || 'Unknown', paragraphIndex: activeParagraphIndex + 1, timestamp: Date.now() };
    const updated = [...bookmarks, newBm];
    setBookmarks(updated);
    await saveBookmarks(activeBook.id, updated);
  };

  const removeBookmark = async (cfi: string) => {
    if (!activeBook) return;
    const updated = bookmarks.filter(b => b.cfi !== cfi);
    setBookmarks(updated);
    await saveBookmarks(activeBook.id, updated);
  };

  const isCurrentPageBookmarked = bookmarks.some(b => b.cfi === currentCfi);
  const toggleBookmark = async () => {
    if (!currentCfi) return;
    if (isCurrentPageBookmarked) await removeBookmark(currentCfi); else await addBookmark();
  };

// ─── Image Generation ─────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!activeBook) { alert("Please open a book first!"); return; }
    
    // Pass the next 50 paragraphs from the current one as context
    const contextForImage = vnParagraphs.slice(activeParagraphIndex, activeParagraphIndex + 50).map(p => p.text).join('\n');
    if (!contextForImage) { alert("Please read a few pages first!"); return; }

    setIsLoadingImage(true);
    try {
      const stylePref = localStorage.getItem('IMAGE_STYLE_PREF') || 'cinematic';
      const enginePref = localStorage.getItem('IMAGE_ENGINE_PREF') || 'online';
      
      let newBg = '';

      if (enginePref === 'local') {
        // --- LOCAL WEBGPU GENERATION ---
        if (!localImageRef.current) {
           localImageRef.current = new LocalImageEngine((msg) => {
              console.log(msg);
              setImageLoadingMsg(msg); 
           });
           await localImageRef.current.init();
        }

        // Local models do better with descriptive keyword lists rather than giant text blocks
        const promptText = "A highly detailed, cinematic illustration of: " + contextForImage.substring(0, 400).replace(/\n/g, ' ');
        newBg = await localImageRef.current.generate(promptText);

        // Passively extract characters in the background using Gemini just so the Cast page populates
        if (stylePref !== 'character-portraits') {
          extractCharacterProfiles(contextForImage).then(async (extracted) => {
            if (extracted.length === 0 || !activeBook) return;
            let latest = await loadCharacters(activeBook.id);
            for (const char of extracted) {
              const profile: CharacterProfile = { name: char.name, description: char.description, updatedAt: Date.now() };
              latest = await upsertCharacter(activeBook.id, profile);
            }
            setCharacters(latest);
          }).catch(e => console.error("Passive character extraction failed", e));
        }

      } else {
        // --- ONLINE GEMINI GENERATION ---
        let finalCharacterContext = characters.length > 0
          ? characters.map(c => `${c.name}: ${c.description}`).join('\n')
          : undefined;

        // If generating "Character Portraits", immediately evaluate profiles before image generation
        if (stylePref === 'character-portraits') {
          const extracted = await extractCharacterProfiles(contextForImage);
          let latest = await loadCharacters(activeBook.id);
          
          for (const char of extracted) {
            const profile: CharacterProfile = { name: char.name, description: char.description, updatedAt: Date.now() };
            latest = await upsertCharacter(activeBook.id, profile);
          }
          setCharacters(latest);
          
          const extractedNames = extracted.map(e => e.name.toLowerCase());
          const presentCharacters = latest.filter(c => extractedNames.includes(c.name.toLowerCase()));
          
          finalCharacterContext = presentCharacters.length > 0 
            ? presentCharacters.map(c => `${c.name}: ${c.description}`).join('\n')
            : undefined;
        }

        newBg = await generateAmbientImage(contextForImage, finalCharacterContext);

        if (stylePref !== 'character-portraits') {
          extractCharacterProfiles(contextForImage).then(async (extracted) => {
            if (extracted.length === 0 || !activeBook) return;
            let latest = await loadCharacters(activeBook.id);
            for (const char of extracted) {
              const profile: CharacterProfile = { name: char.name, description: char.description, updatedAt: Date.now() };
              latest = await upsertCharacter(activeBook.id, profile);
            }
            setCharacters(latest);
          });
        }
      }

      // Shared logic: Save to gallery
      setBgImage(newBg);
      const newItem: GalleryImage = { id: Date.now().toString(), base64: newBg, timestamp: Date.now(), chapter: chapterTitle || 'Unknown' };
      const updatedGallery = [newItem, ...gallery];
      setGallery(updatedGallery);
      await saveGallery(activeBook.id, updatedGallery);

    } catch (e: any) {
      if (e.message === "SAFETY_BLOCKED") {
        setShowSafetyPopup(true);
      } else {
        alert("Failed to generate image. " + e.message);
      }
    } finally {
      setIsLoadingImage(false);
      setImageLoadingMsg('');
    }
  };

// ─── Manual Prompt Generation ──────────────────────────────────────────────
  const handleGenerateAudioPrompt = async () => {
    if (!activeBook || vnParagraphs.length === 0) return;
    
    setIsGeneratingPrompt(true);
    try {
      // Grab the next 100 paragraphs for context as requested
      const contextForMusic = vnParagraphs
        .slice(activeParagraphIndex, activeParagraphIndex + 100)
        .map(p => p.text)
        .join('\n');
        
      const genre = activeBook.anchorGenre || 'Cinematic Instrumental';
      const prompt = await analyzeMusicalSentiment(contextForMusic, genre);
      
      setCurrentAudioPrompt(prompt);
    } catch (e) {
      console.error("Failed to generate audio prompt:", e);
      alert("Failed to analyze scene for audio.");
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  // ─── Music ────────────────────────────────────────────────────────────────
  const toggleMusic = async () => {
    try {
      if (!lyriaRef.current) {
        lyriaRef.current = new LyriaEngine();
        lyriaRef.current.attachCallback((p) => setIsMusicPlaying(p));
      }
      const payload = currentContextText || bookTitle || "Calm ambient background";
      const nowPlaying = await lyriaRef.current.togglePlay(payload);
      setIsMusicPlaying(nowPlaying);
    } catch(e: any) {
      alert("Audio Initialization Failed: " + (e.message || "Cannot connect to Live Music socket."));
    }
  };

  // ─── TTS ──────────────────────────────────────────────────────────────────
  const toggleTts = () => {
    if (isTtsEnabled) {
      window.speechSynthesis.cancel();
      setIsTtsEnabled(false);
    } else {
      setIsTtsEnabled(true);
    }
  };

  // ─── Delete character ─────────────────────────────────────────────────────
  const deleteCharacter = async (name: string) => {
    if (!activeBook) return;
    const updated = characters.filter(c => c.name !== name);
    setCharacters(updated);
    await saveCharacters(activeBook.id, updated);
  };

  // ─── Library View ─────────────────────────────────────────────────────────
  if (!activeBook) {
    return <LibraryPage onOpenBook={openBook} />;
  }

  // ─── TOC Recursive Render Helper ──────────────────────────────────────────
  const renderTocItems = (items: any[], depth = 0): any => {
    return items.map((item: any, idx: number) => (
      <React.Fragment key={`${item.id || idx}-${depth}`}>
        <li>
          <button 
            onClick={() => navigateToHref(item.href)} 
            className={`w-full text-left pr-3 py-2 rounded-lg transition-colors font-body cursor-pointer truncate hover:bg-surface-container-highest hover:text-primary ${depth === 0 ? 'text-on-surface text-sm font-bold' : 'text-on-surface-variant text-xs'}`}
            style={{ paddingLeft: `${(depth * 1.5) + 0.75}rem` }}
          >
            {item.label?.trim()}
          </button>
        </li>
        {/* If this item has nested chapters, call this exact same function again */}
        {item.subitems && item.subitems.length > 0 && renderTocItems(item.subitems, depth + 1)}
      </React.Fragment>
    ));
  };

  // ─── Reader View ─────────────────────────────────────────────────────────
  return (
    <>
      {/* Global Background Vibe */}
      <div className="vibe-bg transition-all duration-1000 ease-in-out" aria-hidden="true" style={{ backgroundImage: `url(${bgImage})` }}></div>

      {/* Top AppBar */}
      <header className="bg-surface flex justify-between items-center w-full px-4 md:px-12 py-4 md:py-6 max-w-full fixed top-0 z-50">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (renditionRef.current) { renditionRef.current.destroy(); renditionRef.current = null; }
              if (bookRef.current) { bookRef.current.destroy(); bookRef.current = null; }
              lyriaRef.current?.stop?.();
              lyriaRef.current = null;
              window.speechSynthesis.cancel();
              setIsMusicPlaying(false); setIsTtsEnabled(false);
              setActiveBook(null); setBookLoaded(false); setVnParagraphs([]);
            }}
            title="Back to Library"
            className="text-on-surface-variant hover:text-primary transition-colors p-1.5 rounded-lg hover:bg-surface-container-high cursor-pointer"
          >
            <span className="material-symbols-outlined text-xl">arrow_back</span>
          </button>
          <span className="text-base md:text-xl font-bold tracking-tighter text-on-surface uppercase font-headline">Nocturne</span>
        </div>
        <div className="flex flex-col items-center max-w-[35%] lg:max-w-lg text-center overflow-hidden">
          <span className="text-sm md:text-lg font-bold font-headline text-primary truncate max-w-full block">{bookTitle}</span>
          <span className="text-[10px] md:text-sm font-label text-on-surface-variant uppercase tracking-widest truncate max-w-full block">{chapterTitle}</span>
        </div>
        <div className="flex gap-1.5 md:gap-3 items-center">
          {/* Music Toggle */}
          <button
            onClick={toggleMusic}
            title="Ambient Real-Time Music"
            className={`transition-colors duration-300 px-2.5 py-1.5 rounded-md border cursor-pointer flex items-center gap-1 ${isMusicPlaying ? 'text-red-400 bg-surface-container border-red-500/30 shadow-inner' : 'text-primary hover:bg-surface-container-high border-surface-container-highest'}`}
          >
            <span className="material-symbols-outlined text-sm">{isMusicPlaying ? 'stop_circle' : 'play_circle'}</span>
            <span className="text-xs font-bold uppercase tracking-wider font-label whitespace-nowrap hidden sm:inline">{isMusicPlaying ? 'Stop Audio' : 'Start Audio'}</span>
          </button>
          {/* TTS Toggle */}
          <div className="flex items-center gap-1 bg-surface-container rounded-lg px-1.5 py-1 border border-surface-container-highest">
            <button
              onClick={toggleTts}
              title={isTtsEnabled ? "Disable Narration" : "Enable Narration"}
              className={`transition-colors duration-300 p-2 rounded-lg cursor-pointer ${isTtsEnabled ? 'text-green-400' : 'text-primary hover:bg-surface-container-high'}`}
            >
              <span className="material-symbols-outlined text-sm">{isTtsEnabled ? 'record_voice_over' : 'voice_over_off'}</span>
            </button>
            {isTtsEnabled && (
              <button
                onClick={() => {
                  const nextRates = [1.0, 1.5, 2.0];
                  const idx = nextRates.indexOf(ttsSpeed);
                  const next = nextRates[(idx + 1) % nextRates.length];
                  setTtsSpeed(next);
                  localStorage.setItem('TTS_SPEED', next.toString());
                  // Also re-speak current if playing
                  if (vnParagraphs[activeParagraphIndex]) {
                    window.speechSynthesis.cancel();
                    const utter = new SpeechSynthesisUtterance(vnParagraphs[activeParagraphIndex].text);
                    utter.rate = next;
                    window.speechSynthesis.speak(utter);
                  }
                }}
                className="text-[10px] font-bold font-mono px-1.5 py-1 rounded bg-black/20 text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
              >
                {ttsSpeed}x
              </button>
            )}
          </div>
          <button onClick={() => { setDrawerTab('toc'); setIsDrawerOpen(true); }} title="Table of Contents" className="text-primary hover:bg-surface-container-high transition-colors duration-300 p-2 rounded-lg cursor-pointer">
            <span className="material-symbols-outlined">menu_book</span>
          </button>
          <button onClick={() => { setDrawerTab('bookmarks'); setIsDrawerOpen(true); }} title="Bookmarks" className="text-primary hover:bg-surface-container-high transition-colors duration-300 p-2 rounded-lg cursor-pointer">
            <span className="material-symbols-outlined">bookmarks</span>
          </button>
          <button onClick={() => { setDrawerTab('gallery'); setIsDrawerOpen(true); }} title="Image Gallery" className="text-primary hover:bg-surface-container-high transition-colors duration-300 p-2 rounded-lg cursor-pointer hidden md:block">
            <span className="material-symbols-outlined">photo_library</span>
          </button>
          <button onClick={() => setIsSettingsOpen(true)} className="text-primary hover:bg-surface-container-high transition-colors duration-300 p-2 rounded-lg cursor-pointer">
            <span className="material-symbols-outlined">settings</span>
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <main className="fixed top-14 md:top-20 bottom-14 md:bottom-20 left-0 right-0 z-0 bg-black flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-center bg-no-repeat transition-transform duration-[120s] ease-linear scale-100"
          style={{ backgroundImage: `url(${bgImage})`, backgroundSize: isStretchImage ? '100% 100%' : 'contain' }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />
        <div className="absolute inset-0 p-8 opacity-0 pointer-events-none -z-10" ref={viewerRef}></div>

        {bookLoaded ? (
          <>
            <div className="absolute top-4 left-6 z-50 w-80 pointer-events-auto">
              <SummarizerMVP paragraphs={vnParagraphs.slice(activeParagraphIndex).map(p => p.text)} />
            </div>

            <div className="absolute top-4 right-6 z-50 flex gap-4 pointer-events-auto shadow-2xl">
              <button onClick={handleGenerate} disabled={isLoadingImage}
                className="bg-black/90 hover:bg-primary border border-outline-variant/30 text-white rounded-full p-4 shadow-lg flex items-center justify-center cursor-pointer backdrop-blur-md transition-all scale-110 disabled:opacity-60 disabled:cursor-not-allowed"
                title={isLoadingImage ? "Generating..." : "Generate Scene Image"}>
                {isLoadingImage
                  ? <span className="material-symbols-outlined animate-spin">progress_activity</span>
                  : <span className="material-symbols-outlined">magic_button</span>}
              </button>
              {imageLoadingMsg && (
                <div className="absolute top-16 right-0 bg-black/80 text-primary text-xs p-2 rounded-lg whitespace-nowrap border border-primary/30 font-mono shadow-xl backdrop-blur-md">
                  {imageLoadingMsg}
                </div>
              )}
              <button onClick={() => { setDrawerTab('characters'); setIsDrawerOpen(true); }}
                className="bg-black/90 hover:bg-surface-container-high border border-outline-variant/30 text-white rounded-full p-4 shadow-lg flex items-center justify-center cursor-pointer backdrop-blur-md transition-all scale-110"
                title="Character Profiles">
                <span className="material-symbols-outlined">person_book</span>
              </button>
              <button onClick={() => setIsExpanded(true)}
                className="bg-black/90 hover:bg-surface-container-high border border-outline-variant/30 text-white rounded-full p-4 shadow-lg flex items-center justify-center cursor-pointer backdrop-blur-md transition-all scale-110"
                title="Expand Image">
                <span className="material-symbols-outlined">fullscreen</span>
              </button>
              <button onClick={() => setIsVnTextHidden(!isVnTextHidden)}
                className="bg-black/90 hover:bg-surface-container-high border border-outline-variant/30 text-white rounded-full p-4 shadow-lg flex items-center justify-center cursor-pointer backdrop-blur-md transition-all scale-110"
                title="Toggle TextBox (H)">
                <span className="material-symbols-outlined">{isVnTextHidden ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>

            {!isVnTextHidden && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-3xl z-40 flex flex-col h-[30vh]">
                <div className="flex justify-between items-center mb-3 shrink-0">
                  <span className="text-primary font-label text-sm uppercase tracking-widest px-3 py-1 bg-black/60 rounded-full border border-primary/20 shadow-inner backdrop-blur-sm">{chapterTitle}</span>
                  <span className="text-white/70 text-xs font-mono tracking-widest bg-black/60 px-3 py-1 rounded-full border border-white/10 backdrop-blur-sm">{activeParagraphIndex + 1} / {vnParagraphs.length || 1}</span>
                </div>


                <div ref={vnTextBoxRef} className="flex-1 overflow-y-auto px-2" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}>
                  {vnParagraphs.length > 0 && vnParagraphs[activeParagraphIndex] ? (
                    <div
                      className="font-body leading-[1.8] tracking-wide transition-all duration-300 rounded-lg p-4 epub-html-content"
                      style={{
                        fontSize: `${((fontSize / 100) * 1.5).toFixed(2)}rem`,
                        backgroundColor: 'rgba(0,0,0,0.25)',
                        color: 'rgba(243, 244, 246, 1)' /* Tailwind text-gray-100 */
                      }}
                      dangerouslySetInnerHTML={{ __html: vnParagraphs[activeParagraphIndex].html || '' }}
                    />
                  ) : (
                    <p
                      className="font-body leading-[1.8] tracking-wide transition-all duration-300 text-gray-100 rounded-lg p-4"
                      style={{
                        fontSize: `${((fontSize / 100) * 1.5).toFixed(2)}rem`,
                        backgroundColor: 'rgba(0,0,0,0.25)',
                      }}
                    >
                      Loading content...
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-on-surface-variant z-10 pointer-events-none">
            <span className="material-symbols-outlined text-5xl md:text-6xl mb-4 opacity-50">hourglass_top</span>
            <p className="font-headline tracking-widest uppercase text-sm md:text-base">Loading book…</p>
          </div>
        )}
      </main>

      {/* BottomNavBar */}
      <footer className="fixed bottom-0 left-0 w-full z-50 h-14 md:h-20 bg-surface-container-low flex justify-between items-center px-4 md:px-12 border-t border-outline-variant/15 text-white/90">
        <div className="flex items-center gap-1 md:gap-6">
          <button onClick={() => { setDrawerTab('toc'); setIsDrawerOpen(true); }} className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center hover:bg-surface-variant hover:text-primary rounded-full transition-all cursor-pointer group" title="Table of Contents">
            <span className="material-symbols-outlined text-[20px] md:text-2xl group-active:scale-90">format_list_bulleted</span>
          </button>
          <button onClick={() => { setDrawerTab('bookmarks'); setIsDrawerOpen(true); }} className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center hover:bg-surface-variant hover:text-primary rounded-full transition-all cursor-pointer group" title="Bookmarks">
            <span className="material-symbols-outlined text-[20px] md:text-2xl group-active:scale-90">bookmarks</span>
          </button>
          <button onClick={() => { setDrawerTab('gallery'); setIsDrawerOpen(true); }} className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center hover:bg-surface-variant hover:text-primary rounded-full transition-all cursor-pointer group" title="Gallery">
            <span className="material-symbols-outlined text-[20px] md:text-2xl group-active:scale-90">photo_library</span>
          </button>
        </div>
        <div className="flex items-center gap-2 bg-surface-variant/40 rounded-full px-2 py-1 border border-outline-variant/20 mx-2 md:mx-4">
          <button onClick={() => setFontSize(f => Math.max(50, f - 10))} disabled={!bookLoaded} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-variant hover:text-primary transition-all cursor-pointer">
            <span className="font-label font-bold text-sm select-none">A-</span>
          </button>
          <span className="text-xs font-mono w-10 text-center opacity-70 select-none">{(fontSize / 100).toFixed(1)}x</span>
          <button onClick={() => setFontSize(f => Math.min(250, f + 10))} disabled={!bookLoaded} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-variant hover:text-primary transition-all cursor-pointer">
            <span className="font-label font-bold text-sm select-none">A+</span>
          </button>
        </div>
        <div className="hidden lg:flex flex-1 max-w-xl mx-8 h-1.5 bg-surface-container-high rounded-full overflow-hidden items-center">
          <div className="h-full bg-primary/70" style={{ width: `${vnParagraphs.length > 0 ? (activeParagraphIndex / vnParagraphs.length) * 100 : 0}%` }}></div>
        </div>
        <div className="flex items-center gap-1 md:gap-4 shrink-0">
          <button onClick={() => prevPage()} className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center hover:bg-surface-variant hover:text-primary rounded-full transition-all cursor-pointer group active:bg-primary/20">
            <span className="material-symbols-outlined text-[20px] md:text-3xl font-light transform group-active:-translate-x-1 transition-transform">chevron_left</span>
          </button>
          <button onClick={toggleBookmark} disabled={!currentCfi}
            className={`w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full transition-all cursor-pointer group ${isCurrentPageBookmarked ? 'bg-primary text-on-primary' : 'hover:bg-surface-variant hover:text-primary'}`}>
            <span className="material-symbols-outlined text-[20px] md:text-2xl group-active:scale-90">{isCurrentPageBookmarked ? 'bookmark_added' : 'bookmark_add'}</span>
          </button>
          <button onClick={() => nextPage()} className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center hover:bg-surface-variant hover:text-primary rounded-full transition-all cursor-pointer group active:bg-primary/20">
            <span className="material-symbols-outlined text-[20px] md:text-3xl font-light transform group-active:translate-x-1 transition-transform">chevron_right</span>
          </button>
        </div>
      </footer>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Drawer */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-[150] flex">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setIsDrawerOpen(false)}></div>
          <div className="relative w-[85vw] max-w-sm h-full bg-surface-container-high border-r border-outline-variant/20 shadow-2xl flex flex-col animate-in slide-in-from-left duration-300 overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="text-lg font-headline font-bold text-on-surface uppercase tracking-wider">
                {drawerTab === 'toc' ? 'Contents' : drawerTab === 'bookmarks' ? 'Bookmarks' : drawerTab === 'gallery' ? 'Gallery' : 'Characters'}
              </h2>
              <button onClick={() => setIsDrawerOpen(false)} className="text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-outline-variant/20 px-2">
              {(['toc', 'bookmarks', 'gallery', 'characters', 'genre'] as const).map(tab => (
                <button key={tab} onClick={() => setDrawerTab(tab)}
                  className={`flex-1 pb-3 pt-1 text-[10px] font-label font-bold uppercase tracking-widest text-center transition-colors cursor-pointer ${drawerTab === tab ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>
                  {tab === 'toc' ? 'Chapters' : tab === 'characters' ? 'Cast' : tab === 'genre' ? 'Audio' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-3">
              {/* TOC */}
              {/* TOC */}
              {drawerTab === 'toc' && (
                <ul className="space-y-0.5">
                  {tocItems.length === 0 && <li className="text-on-surface-variant text-sm text-center py-8">No table of contents available.</li>}
                  {renderTocItems(tocItems)}
                </ul>
              )}

              {/* Bookmarks */}
              {drawerTab === 'bookmarks' && (
                <ul className="space-y-1">
                  {bookmarks.length === 0 && <li className="text-on-surface-variant text-sm text-center py-8">No bookmarks yet.<br />Use the bookmark button at the bottom.</li>}
                  {[...bookmarks].sort((a, b) => b.timestamp - a.timestamp).map((bm, idx) => (
                    <li key={idx} className="flex items-center gap-2 group">
                      <button onClick={() => navigateToBookmark(bm)} className="flex-1 text-left px-3 py-2.5 rounded-lg text-on-surface hover:bg-surface-container-highest hover:text-primary transition-colors cursor-pointer truncate">
                        <span className="text-sm font-body block truncate">{bm.label}{bm.paragraphIndex ? ` — Para ${bm.paragraphIndex}` : ''}</span>
                        <span className="text-[10px] text-on-surface-variant font-label">{new Date(bm.timestamp).toLocaleDateString()} {new Date(bm.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </button>
                      <button onClick={() => removeBookmark(bm.cfi)} className="opacity-0 group-hover:opacity-100 text-on-surface-variant hover:text-red-400 transition-all p-1 cursor-pointer">
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Gallery */}
              {drawerTab === 'gallery' && (
                <div className="grid grid-cols-2 gap-3 p-2">
                  {gallery.length === 0 && <div className="col-span-2 text-on-surface-variant text-sm text-center py-8">No images yet.<br />Click the sparkle button to visualize a scene!</div>}
                  {gallery.map((img) => (
                    <div key={img.id} className="flex flex-col gap-1 group relative">
                      <div className="aspect-video w-full rounded-lg overflow-hidden border border-outline-variant/30 cursor-pointer hover:border-primary transition-colors relative"
                        onClick={() => { setBgImage(img.base64); setIsDrawerOpen(false); }}>
                        <img src={img.base64} alt={img.chapter} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                          <span className="material-symbols-outlined text-3xl">wallpaper</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-on-surface-variant font-label truncate px-1 text-center font-bold">{img.chapter}</span>
                      <button onClick={async (e) => { e.stopPropagation(); if (!activeBook) return; const up = gallery.filter(g => g.id !== img.id); setGallery(up); await saveGallery(activeBook.id, up); }}
                        className="absolute top-1 right-1 bg-surface/80 hover:bg-red-500/80 hover:text-white text-on-surface-variant rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer backdrop-blur-sm">
                        <span className="material-symbols-outlined text-xs">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Characters */}
              {drawerTab === 'characters' && (
                <div className="px-1">
                  {characters.length === 0 ? (
                    <div className="text-on-surface-variant text-sm text-center py-8 px-4 leading-relaxed">
                      <span className="material-symbols-outlined text-3xl block mb-2 opacity-30">person_search</span>
                      No character profiles yet.<br />Generate a scene image to auto-extract character appearances.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {[...characters].sort((a, b) => b.updatedAt - a.updatedAt).map((char) => (
                        <li key={char.name} className="group border border-outline-variant/20 rounded-xl overflow-hidden">
                          <button
                            onClick={() => setExpandedCharacter(expandedCharacter === char.name ? null : char.name)}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-container-highest transition-colors cursor-pointer text-left"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg overflow-hidden border border-primary/30 flex items-center justify-center bg-primary/20 shrink-0">
                                {char.portrait
                                  ? <img src={char.portrait} alt={char.name} className="w-full h-full object-cover" />
                                  : <span className="text-sm font-bold text-primary">{char.name.charAt(0).toUpperCase()}</span>
                                }
                              </div>
                              <span className="text-sm font-bold text-on-surface font-body">{char.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-on-surface-variant font-label">{new Date(char.updatedAt).toLocaleDateString()}</span>
                              <span className="material-symbols-outlined text-sm text-on-surface-variant">{expandedCharacter === char.name ? 'expand_less' : 'expand_more'}</span>
                            </div>
                          </button>
                          {expandedCharacter === char.name && (
                            <div className="px-4 pb-4 bg-surface-container/50">
                              {char.portrait && (
                                <img src={char.portrait} alt={char.name} className="w-full h-40 object-cover rounded-lg mb-3 border border-outline-variant/20" />
                              )}
                              <p className="text-xs text-on-surface-variant font-body leading-relaxed mb-3">{char.description}</p>
                              <button onClick={() => deleteCharacter(char.name)}
                                className="text-[10px] text-red-400/70 hover:text-red-400 transition-colors cursor-pointer font-label uppercase tracking-wider flex items-center gap-1">
                                <span className="material-symbols-outlined text-xs">delete</span> Remove Profile
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Genre / Audio Settings */}
              {drawerTab === 'genre' && activeBook && (
                <div className="px-4 py-6 flex flex-col gap-4 animate-in fade-in duration-300">
                  <h3 className="text-sm font-headline font-bold text-on-surface uppercase tracking-widest">Soundtrack Anchor</h3>
                  <p className="text-xs text-on-surface-variant font-body leading-relaxed">
                    Set the core musical genre for this book (e.g., Cyberpunk, Ambient Fantasy, Western). 
                    The Lyria audio engine uses this to dynamically steer the continuous background score.
                  </p>
                  <input
                    type="text"
                    defaultValue={activeBook.anchorGenre || ''}
                    placeholder="Cinematic Instrumental"
                    className="w-full bg-surface-container border border-outline-variant/30 rounded-lg px-4 py-3 text-sm text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                    onBlur={async (e) => {
                      const val = e.target.value.trim() || 'Cinematic Instrumental';
                      if (val !== activeBook.anchorGenre) {
                        const updatedMeta = { ...activeBook, anchorGenre: val };
                        await addBookToLibrary(updatedMeta);
                        setActiveBook(updatedMeta);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                  />

                  {/* --- NEW SCENE PROMPT SECTION --- */}
                  <div className="mt-4 border-t border-outline-variant/30 pt-6">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-headline font-bold text-on-surface uppercase tracking-widest">Scene Prompt</h3>
                      <div className="flex gap-2 items-center">
                        <button 
                          onClick={handleGenerateAudioPrompt}
                          disabled={isGeneratingPrompt}
                          className="text-[11px] flex items-center gap-1.5 bg-surface-variant hover:bg-surface-container-highest text-on-surface px-3 py-1.5 rounded-md transition-colors cursor-pointer font-bold uppercase tracking-wider disabled:opacity-50"
                        >
                          {isGeneratingPrompt ? (
                            <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                          ) : (
                            <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                          )}
                          Generate
                        </button>
                        <button 
                          onClick={() => {
                            if (currentAudioPrompt) navigator.clipboard.writeText(currentAudioPrompt);
                          }}
                          disabled={!currentAudioPrompt}
                          className="text-[11px] flex items-center gap-1.5 bg-primary/20 hover:bg-primary hover:text-on-primary text-primary px-3 py-1.5 rounded-md transition-colors cursor-pointer font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Copy to Clipboard"
                        >
                          <span className="material-symbols-outlined text-[14px]">content_copy</span> Copy
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-on-surface-variant mb-3 leading-relaxed">
                      Analyze the next 100 paragraphs to generate a prompt, then copy it to create a high-fidelity track in Google AI Studio.
                    </p>
                    <textarea
                      readOnly
                      value={currentAudioPrompt || (isGeneratingPrompt ? "Analyzing scene..." : "Click 'Generate' to analyze the current scene...")}
                      className="w-full h-32 bg-surface-container-highest border border-outline-variant/20 rounded-lg p-3 text-xs font-mono text-on-surface-variant resize-none focus:outline-none focus:border-primary/50 transition-colors"
                    />
                  </div>
                  {/* -------------------------------- */}

                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Image Overlay */}
      {isExpanded && (
        <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-lg flex items-center justify-center cursor-pointer" onClick={() => setIsExpanded(false)}>
          <img src={bgImage} alt="Expanded" className="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl animate-in fade-in zoom-in-95 duration-300" />
          <button className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center bg-surface/50 hover:bg-surface/80 backdrop-blur-md rounded-full text-on-surface transition-all cursor-pointer" onClick={() => setIsExpanded(false)}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      )}
      {/* Safety Restriction Popup */}
      {showSafetyPopup && (
        <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-surface-container-high border border-red-500/30 rounded-2xl p-6 w-full max-w-sm shadow-2xl flex flex-col gap-4 animate-in zoom-in-95 duration-300">
            <div className="flex items-center gap-3 text-red-400">
              <span className="material-symbols-outlined text-3xl">gpp_maybe</span>
              <h3 className="text-xl font-headline font-bold">Safety Restriction</h3>
            </div>
            <p className="text-sm font-body text-on-surface-variant leading-relaxed">
              Gemini refused to generate an image for this scene because the context triggered the API's safety filters (e.g., violence, explicit content, or restricted topics).
            </p>
            <button
              className="w-full bg-surface-variant hover:bg-red-500/20 text-on-surface hover:text-red-400 font-label font-bold uppercase tracking-wider py-3 rounded-lg transition-colors shadow-md mt-2 cursor-pointer border border-transparent hover:border-red-500/50"
              onClick={() => setShowSafetyPopup(false)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}
