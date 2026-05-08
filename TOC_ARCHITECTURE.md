# Visual EReader: Table of Contents & Navigation Architecture

This document provides a comprehensive, deep-dive explanation of how the Table of Contents (TOC) and chapter navigation currently function in the Visual EReader. 

To fix the TOC, we first must understand the underlying theory of how `epub.js` works and how our application attempts to "hijack" it to create the Visual Novel / TikTok paragraph-by-paragraph experience.

---

## 1. The Core Theory: Two Competing Rendering Paradigms

The fundamental complexity of the Visual EReader is that we are running **two completely different rendering systems simultaneously** and trying to keep them perfectly synced.

### Paradigm A: The `epub.js` Engine (The Source of Truth)
`epub.js` is a library designed to render e-books like a traditional reader (e.g., Apple Books or Kindle). 
- **The Spine:** An ePub file is essentially a zipped website. The "Spine" is the ordered array of HTML files inside it (e.g., `chapter1.html`, `chapter2.html`).
- **The Rendition:** `epub.js` renders these HTML files inside hidden `<iframe>` elements in the DOM.
- **CFI (Canonical Fragment Identifier):** Because text reflows based on screen size and font size, standard page numbers don't work in ePubs. Instead, `epub.js` uses CFIs (e.g., `epubcfi(/6/14!/4/2/1:0)`). A CFI is essentially a set of GPS coordinates that points to an exact character inside an exact HTML node within a specific Spine item.

### Paradigm B: The Visual Novel (VN) UI (What the User Sees)
We don't want the user to read traditional pages. We want them to read **one paragraph at a time** centered on the screen (the VN / TikTok mode).
- We hide the `epub.js` iframe behind the scenes (using opacity or z-index).
- We maintain a React state array called `vnParagraphs`, which contains the text of every paragraph in the *current chapter*.
- We track our position using `activeParagraphIndex`.

### The Bridge: Keeping Them Synced
Because the VN UI only knows about "paragraphs" and `epub.js` only knows about "CFIs", we have to constantly translate between the two. 
- When the user swipes to the next paragraph, we get that paragraph's CFI and tell `epub.js`: *"Hey, silently scroll your hidden iframe to this CFI."*
- When the user clicks a TOC link, we tell `epub.js`: *"Hey, load this new chapter."* Then we wait for it to finish, scrape the new HTML out of the hidden iframe, chop it into paragraphs, and feed it to our VN UI.

---

## 2. The Detailed Logic: Step-by-Step

Here is the exact lifecycle of what happens when you click a Table of Contents link.

### Step 1: The Click (`navigateToHref`)
When you click "Chapter 5" in the sidebar, `navigateToHref('chapter05.html')` is triggered.

1. **State Reset:** We wipe our navigation memory. We set `lastSpineHrefRef.current = ''` and `pendingCfi.current = null`. This ensures the app knows we are entering entirely new territory.
2. **Flagging:** We set `isInternalVnNavigation.current = false`. This is a crucial flag. When it is `true`, it means *we* are just swiping between paragraphs in the same chapter. When it is `false`, it means a major chapter jump is happening.
3. **Execution:** We call `renditionRef.current.display('chapter05.html')`. This tells `epub.js` to dump the current hidden iframe and load the new HTML file.

### Step 2: The `relocated` Event (The Synchronizer)
Whenever `epub.js` finishes moving to a new location, it fires a `relocated` event. This event is the heart of our application (located around line 806 in `App.tsx`).

When the TOC triggers this event, here is the exact logic path:

1. **Auto-Save:** It immediately saves the new CFI to the database so you can resume here later.
2. **Internal Check:** It checks `if (isInternalVnNavigation.current) return;`. Because we set this to `false` in Step 1, we pass the gate and proceed.
3. **The Delay:** It triggers a `setTimeout` for 100 milliseconds. *(Note: This is where the fatal flaw lies, explained in Section 3).*
4. **DOM Extraction:** After 100ms, it asks `epub.js` for the raw DOM document of the hidden iframe: `renditionRef.current.getRange(location.start.cfi)`.
5. **Element Querying:** It runs `activeDoc.body.querySelectorAll('p, blockquote, li, h1, h2, h3')` to grab every single readable element in the chapter.
6. **Graph Building:** It loops through every element. For each one, it asks `epub.js` to generate a native CFI. It pushes `{ text, cfi, html }` into a temporary array called `chapterGraph`.
7. **State Update:** It updates `vnParagraphs = chapterGraph`.
8. **Index Resolution:** It determines which paragraph we should be looking at. Because `pendingCfi` is null (cleared in Step 1), it defaults to `forcedIndex = 0`.
9. **Final Sync:** It sets `activeParagraphIndex = 0` (so the UI shows the first paragraph) and then tells `epub.js` to explicitly lock onto that exact paragraph's CFI.

---

## 3. The Breakdown: Why the TOC is Failing

You are experiencing a bug where clicking a TOC chapter does not actually take you to the new paragraphs. The `epub.js` engine moves, but the VN UI stays stuck on the old chapter.

Here is exactly why that happens:

**The Race Condition in Step 2.3 & 2.4**
When `epub.js` fires the `relocated` event, it is essentially saying *"I have calculated where I am going."* It does **not** necessarily mean *"The HTML iframe is 100% finished rendering in the browser."*

Our code uses a blind `setTimeout` of 100ms, assuming that is enough time for the browser to paint the hidden iframe. 
If the chapter is large, or the device is slow, 100ms is not enough. 

When our code runs `renditionRef.current.getRange()` at the 100ms mark, `epub.js` looks at the hidden iframe, sees that it isn't ready, and throws an error (or returns `null`).

**The Silent Abort**
If you look at the code:
```typescript
const startRange = renditionRef.current.getRange(location.start.cfi);
if (!startRange) return; // <--- THE SILENT KILLER
```
Because `startRange` is null, the function hits `return`. It completely aborts the paragraph extraction process. 

Because the extraction is aborted, `setVnParagraphs` is never called. Your React state still holds the `vnParagraphs` from the *previous* chapter. You are trapped in the past.

---

## 4. Architectural Solutions

To fix this permanently, we need to eliminate the race condition. We cannot rely on a blind 100ms timeout.

### Solution A: The `rendered` Event Listener
`epub.js` emits a `rendered` event when a view has been completely attached and painted to the DOM. Instead of building the paragraph graph inside `relocated`, we should move the DOM extraction logic into the `rendered` event. This guarantees the iframe is ready.

### Solution B: Promise Polling
If we must stay inside `relocated`, we can implement a polling mechanism. Instead of a single 100ms timeout, we write a recursive function that checks if `getRange()` is available every 50ms, up to a maximum of 2 seconds. Once it's available, we extract the paragraphs.

### Solution C: `display().then()` chaining
`rendition.display()` returns a Promise that resolves when the section is loaded. We could move the paragraph extraction out of the `relocated` handler entirely for major TOC jumps, and put it directly inside `navigateToHref`:
```typescript
await renditionRef.current.display(href);
// The promise resolves here, meaning the iframe is ready.
// Extract paragraphs right here.
```

I recommend implementing **Solution C** combined with robust error handling, as it keeps the TOC navigation logic cleanly contained within `navigateToHref` rather than splitting it across global event listeners.
