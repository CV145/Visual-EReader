/**
 * db.ts — Namespaced LocalForage helpers for Nocturne multi-book library.
 * All per-book data is stored under keys scoped to a unique bookId (UUID).
 */
import localforage from 'localforage';
import { consolidateCharacterProfiles } from './gemini';

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  coverBase64: string | null;
  addedAt: number;
  lastOpenedAt: number;
  lastCfi: string | null;
  anchorGenre: string | null;
}

export interface Bookmark {
  cfi: string;
  label: string;
  paragraphIndex?: number;
  timestamp: number;
}

export interface GalleryImage {
  id: string;
  base64: string;
  timestamp: number;
  chapter: string;
}

export interface CharacterProfile {
  name: string;
  description: string; // Appearance details extracted by AI
  bio?: string;        // Information about who the character is (personality, role, etc.)
  portrait?: string;   // Base64 data URL of AI-generated portrait (oil-painting style)
  updatedAt: number;
  profile?: string; //Biography/lore
}

// ─── Library Manifest ────────────────────────────────────────────────────────

export const getLibrary = async (): Promise<BookMeta[]> => {
  return (await localforage.getItem<BookMeta[]>('library_manifest')) ?? [];
};

export const saveLibrary = async (lib: BookMeta[]) => {
  await localforage.setItem('library_manifest', lib);
};

export const addBookToLibrary = async (meta: BookMeta): Promise<void> => {
  const lib = await getLibrary();
  const existing = lib.findIndex(b => b.id === meta.id);
  if (existing >= 0) lib[existing] = meta;
  else lib.unshift(meta);
  await saveLibrary(lib);
};

export const deleteBookFromLibrary = async (bookId: string): Promise<void> => {
  const lib = await getLibrary();
  await saveLibrary(lib.filter(b => b.id !== bookId));
  // Remove all namespaced data for this book
  await localforage.removeItem(`file_${bookId}`);
  await localforage.removeItem(`bookmarks_${bookId}`);
  await localforage.removeItem(`gallery_${bookId}`);
  await localforage.removeItem(`characters_${bookId}`);
  await localforage.removeItem(`location_${bookId}`);
  await localforage.removeItem(`summary_${bookId}`);
};

// ─── Book File ───────────────────────────────────────────────────────────────

export const saveBookFile = async (bookId: string, data: ArrayBuffer) => {
  await localforage.setItem(`file_${bookId}`, data);
};

export const loadBookFile = async (bookId: string): Promise<ArrayBuffer | null> => {
  return localforage.getItem<ArrayBuffer>(`file_${bookId}`);
};

// ─── Reading Location ─────────────────────────────────────────────────────────

export const saveLocation = async (bookId: string, cfi: string) => {
  await localforage.setItem(`location_${bookId}`, cfi);
  // Also update lastOpenedAt in manifest
  const lib = await getLibrary();
  const idx = lib.findIndex(b => b.id === bookId);
  if (idx >= 0) { lib[idx].lastOpenedAt = Date.now(); lib[idx].lastCfi = cfi; await saveLibrary(lib); }
};

export const loadLocation = async (bookId: string): Promise<string | null> => {
  return localforage.getItem<string>(`location_${bookId}`);
};

// ─── Bookmarks ────────────────────────────────────────────────────────────────

export const loadBookmarks = async (bookId: string): Promise<Bookmark[]> => {
  return (await localforage.getItem<Bookmark[]>(`bookmarks_${bookId}`)) ?? [];
};

export const saveBookmarks = async (bookId: string, bms: Bookmark[]) => {
  await localforage.setItem(`bookmarks_${bookId}`, bms);
};

// ─── Gallery ──────────────────────────────────────────────────────────────────

export const loadGallery = async (bookId: string): Promise<GalleryImage[]> => {
  return (await localforage.getItem<GalleryImage[]>(`gallery_${bookId}`)) ?? [];
};

export const saveGallery = async (bookId: string, imgs: GalleryImage[]) => {
  await localforage.setItem(`gallery_${bookId}`, imgs);
};

// ─── Summaries ────────────────────────────────────────────────────────────────

export const loadSummary = async (bookId: string): Promise<string | null> => {
  return localforage.getItem<string>(`summary_${bookId}`);
};

export const saveSummary = async (bookId: string, summary: string) => {
  await localforage.setItem(`summary_${bookId}`, summary);
};

// ─── Character Profiles ───────────────────────────────────────────────────────

export const loadCharacters = async (bookId: string): Promise<CharacterProfile[]> => {
  const raw = (await localforage.getItem<CharacterProfile[]>(`characters_${bookId}`)) ?? [];
  // Purge any profiles with blank descriptions on load
  const clean = raw.filter(c => c.name.trim().length > 0 && c.description.trim().length > 0);
  if (clean.length !== raw.length) await localforage.setItem(`characters_${bookId}`, clean);
  return clean;
};

export const saveCharacters = async (bookId: string, profiles: CharacterProfile[]) => {
  await localforage.setItem(`characters_${bookId}`, profiles);
};

export const upsertCharacter = async (bookId: string, incoming: CharacterProfile): Promise<CharacterProfile[]> => {
  // Reject blank profiles immediately — require a name and at least ONE descriptor
  if (!incoming.name.trim() || (!incoming.description?.trim() && !incoming.profile?.trim())) {
    return loadCharacters(bookId);
  }

  // FORCE FIRST NAME ONLY: Split the name by spaces and take the first item
  incoming.name = incoming.name.trim().split(/\s+/)[0];

  const existing = await loadCharacters(bookId);
  const idx = existing.findIndex(c => c.name.toLowerCase() === incoming.name.toLowerCase());
  
  if (idx >= 0) {
    const old = existing[idx];
    
    // Merge both Appearance and Lore using AI
    const oldData = { description: old.description || '', profile: old.profile || '' };
    const newData = { description: incoming.description || '', profile: incoming.profile || '' };

    let consolidated = oldData;

    // Only consolidate if there is actually new info to add
    if ((newData.description && !oldData.description.includes(newData.description)) || 
        (newData.profile && !oldData.profile.includes(newData.profile))) {
      try {
        consolidated = await consolidateCharacterProfiles(oldData, newData);
      } catch (e) {
        console.warn("AI Consolidation failed, falling back to safe append.", e);
        consolidated = {
          description: `${oldData.description}${newData.description ? '. ' + newData.description : ''}`.trim(),
          profile: `${oldData.profile}${newData.profile ? '. ' + newData.profile : ''}`.trim()
        };
      }
    }

    existing[idx] = { 
      ...old, 
      description: consolidated.description,
      profile: consolidated.profile,
      updatedAt: incoming.updatedAt 
    };
  } else {
    // Brand new character — add them
    existing.push(incoming);
  }
  
  await saveCharacters(bookId, existing);
  return existing;
};
