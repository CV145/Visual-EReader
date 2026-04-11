import React, { useState, useEffect, useRef } from 'react';
import { BookMeta, getLibrary, saveBookFile, addBookToLibrary, deleteBookFromLibrary } from './db';

interface LibraryPageProps {
  onOpenBook: (book: BookMeta) => void;
}

function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
}

async function extractCoverFromEpub(data: ArrayBuffer): Promise<string | null> {
  try {
    // Dynamically import ePub to extract cover image as base64
    const ePub = (await import('epubjs')).default;
    const book = ePub(data as any);
    await book.ready;
    const coverUrl: string | null = await book.coverUrl().catch(() => null);
    if (!coverUrl) { book.destroy(); return null; }
    // Fetch the blob URL and convert to base64
    const resp = await fetch(coverUrl);
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export default function LibraryPage({ onOpenBook }: LibraryPageProps) {
  const [library, setLibrary] = useState<BookMeta[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getLibrary().then(setLibrary);
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bookId = generateId();

      // Extract metadata
      const ePub = (await import('epubjs')).default;
      const book = ePub(arrayBuffer as any);
      await book.ready;
      const metadata = await book.loaded.metadata;
      const title = metadata?.title || file.name.replace('.epub', '');
      const author = metadata?.creator || 'Unknown Author';
      book.destroy();

      // Extract cover
      const coverBase64 = await extractCoverFromEpub(arrayBuffer);

      // Save file + manifest entry
      await saveBookFile(bookId, arrayBuffer);
      const meta: BookMeta = {
        id: bookId,
        title,
        author,
        coverBase64,
        addedAt: Date.now(),
        lastOpenedAt: Date.now(),
        lastCfi: null,
      };
      await addBookToLibrary(meta);
      setLibrary(prev => [meta, ...prev]);
    } catch (err) {
      alert('Failed to import book: ' + (err as any).message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (bookId: string) => {
    await deleteBookFromLibrary(bookId);
    setLibrary(prev => prev.filter(b => b.id !== bookId));
    setDeleteConfirm(null);
  };

  return (
    <div className="min-h-screen bg-[#0b0c10] text-white flex flex-col">
      {/* Hero Header */}
      <header className="relative z-10 flex items-center justify-between px-6 md:px-16 py-6 border-b border-white/5">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tighter font-headline text-on-surface uppercase">
            Nocturne
          </h1>
          <p className="text-xs text-on-surface-variant font-label uppercase tracking-widest mt-0.5">Your Library</p>
        </div>
        <label
          className="flex items-center gap-2 bg-primary hover:bg-primary/80 text-on-primary px-4 py-2.5 rounded-xl text-sm font-bold font-label uppercase tracking-wider cursor-pointer transition-all shadow-lg hover:shadow-primary/30 hover:scale-105"
          title="Import EPUB"
        >
          {isUploading ? (
            <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
          ) : (
            <span className="material-symbols-outlined text-base">add</span>
          )}
          {isUploading ? 'Importing…' : 'Add Book'}
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub"
            className="hidden"
            onChange={handleFileUpload}
            disabled={isUploading}
          />
        </label>
      </header>

      {/* Library Grid */}
      <main className="flex-1 px-6 md:px-16 py-10">
        {library.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[60vh] gap-5 text-on-surface-variant">
            <span className="material-symbols-outlined text-7xl opacity-30">auto_stories</span>
            <p className="text-base font-label uppercase tracking-widest opacity-50">No books yet</p>
            <label className="flex items-center gap-2 border border-primary/40 hover:border-primary text-primary px-5 py-3 rounded-xl text-sm font-bold cursor-pointer transition-all hover:bg-primary/10">
              <span className="material-symbols-outlined text-base">upload_file</span>
              Import your first EPUB
              <input type="file" accept=".epub" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>
        ) : (
          <>
            <p className="text-xs text-on-surface-variant/60 font-label uppercase tracking-widest mb-6">
              {library.length} {library.length === 1 ? 'book' : 'books'}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5 md:gap-8">
              {library.map(book => (
                <div key={book.id} className="flex flex-col gap-2 group relative">
                  {/* Book Cover Card */}
                  <button
                    onClick={() => onOpenBook(book)}
                    className="relative aspect-[2/3] w-full rounded-xl overflow-hidden border border-white/5 shadow-xl group-hover:border-primary/40 group-hover:shadow-primary/10 transition-all duration-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/60"
                  >
                    {book.coverBase64 ? (
                      <img
                        src={book.coverBase64}
                        alt={book.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-surface-container to-surface-container-high flex flex-col items-center justify-center gap-2 p-4">
                        <span className="material-symbols-outlined text-4xl text-primary/60">menu_book</span>
                        <span className="text-[10px] text-on-surface-variant text-center leading-tight font-label uppercase tracking-wide opacity-70">{book.title}</span>
                      </div>
                    )}
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-3">
                      <span className="text-xs font-bold uppercase tracking-widest text-white font-label bg-primary/80 px-3 py-1.5 rounded-full">Open</span>
                    </div>
                    {/* Last read indicator */}
                    {book.lastCfi && (
                      <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary shadow-lg shadow-primary/50" title="In Progress" />
                    )}
                  </button>

                  {/* Book Info */}
                  <div className="px-0.5">
                    <p className="text-xs font-bold text-on-surface truncate leading-tight font-body">{book.title}</p>
                    <p className="text-[10px] text-on-surface-variant truncate font-label mt-0.5">{book.author}</p>
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(book.id); }}
                    className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/60 hover:bg-red-500/80 text-white/70 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm cursor-pointer"
                    title="Remove book"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-surface-container-high border border-outline-variant/30 rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <span className="material-symbols-outlined text-4xl text-red-400 block mb-3">warning</span>
            <h3 className="text-lg font-bold font-headline text-on-surface mb-2">Remove Book?</h3>
            <p className="text-sm text-on-surface-variant font-body mb-6 leading-relaxed">
              This will permanently delete the book file, all bookmarks, the image gallery, and character profiles for this title.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-xl border border-outline-variant/30 text-on-surface-variant hover:text-on-surface text-sm font-bold font-label uppercase tracking-wider transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold font-label uppercase tracking-wider transition-all cursor-pointer shadow-lg"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
