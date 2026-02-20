import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Storage (localStorage — works in any browser, any host) ──
const SK = "neural-shelf-books-v2";
const IK = "neural-shelf-imgs-v2";
function load() { try { const r = localStorage.getItem(SK); return r ? JSON.parse(r) : []; } catch { return []; } }
function save(books) { try { localStorage.setItem(SK, JSON.stringify(books)); } catch (e) { console.error("Save failed", e); } }
function loadImages() { try { const r = localStorage.getItem(IK); return r ? JSON.parse(r) : []; } catch { return []; } }
function saveImages(imgs) { try { localStorage.setItem(IK, JSON.stringify(imgs)); } catch (e) { console.error("Image save failed", e); } }

// ── Image compression ──
function compressImage(file, maxW=1200, quality=0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width, h = img.height;
        if (w > maxW) { h = (maxW / w) * h; w = maxW; }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Constants ──
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const RAINBOW = ["#E85D75","#E8913A","#F5C542","#5BBD72","#4FC1C9","#4A90D9","#9C6ADE","#E88ABF"];
const DEWEY_META = {
  "0":{ color:"#4FC1C9", label:"Information & CS" },
  "1":{ color:"#E85D75", label:"Philosophy & Psych" },
  "2":{ color:"#9C6ADE", label:"Religion" },
  "3":{ color:"#E8913A", label:"Social Sciences" },
  "4":{ color:"#4A90D9", label:"Language" },
  "5":{ color:"#5BBD72", label:"Science" },
  "6":{ color:"#F5C542", label:"Technology" },
  "7":{ color:"#E88ABF", label:"Arts" },
  "8":{ color:"#E85D75", label:"Literature" },
  "9":{ color:"#8B7530", label:"History & Geo" },
};
function deweyColor(d) { return d ? (DEWEY_META[d.charAt(0)]?.color || "#8B8580") : "#8B8580"; }
function deweyLabel(d) { return d ? (DEWEY_META[d.charAt(0)]?.label || "") : ""; }
function wordColor(word) { const i = word.charCodeAt(0) % RAINBOW.length; return RAINBOW[i]; }
function letterColor(letter) { return RAINBOW[LETTERS.indexOf(letter) % RAINBOW.length]; }

// ── Main ──
export default function NeuralShelfStudio() {
  const [books, setBooks] = useState(() => load());
  const [loaded, setLoaded] = useState(true);
  const [view, setView] = useState("library");
  const [activeBookId, setActiveBookId] = useState(null);
  const [activeLetter, setActiveLetter] = useState(null);
  const [wordInput, setWordInput] = useState("");
  const [search, setSearch] = useState("");
  const [linkMode, setLinkMode] = useState(false);
  const [linkFrom, setLinkFrom] = useState(null);
  const [linkTo, setLinkTo] = useState("");
  const [editingBook, setEditingBook] = useState(null);
  const [images, setImages] = useState(() => loadImages());
  const [imgTagging, setImgTagging] = useState(null); // id of image being tagged
  const [imgExpanded, setImgExpanded] = useState(null); // id of expanded image
  const wordRef = useRef(null);
  const fileRef = useRef(null);

  // Form state for add/edit
  const emptyForm = { title:"", author:"", dewey:"", tags:"", letterRange:"" };
  const [form, setForm] = useState(emptyForm);

  useEffect(() => { save(books); }, [books, loaded]);
  useEffect(() => { saveImages(images); }, [images, loaded]);

  const activeBook = books.find(b => b.id === activeBookId);

  // ── Book Actions ──
  const addBook = () => {
    if (!form.title.trim()) return;
    const book = {
      id: Date.now().toString(),
      title: form.title.trim(),
      author: form.author.trim(),
      dewey: form.dewey.trim(),
      tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
      letterRange: form.letterRange.trim(),
      created: new Date().toISOString(),
      letters: {},
      links: [],
    };
    setBooks(prev => [book, ...prev]);
    setForm(emptyForm);
    setActiveBookId(book.id);
    setView("book");
  };

  const updateBook = () => {
    if (!editingBook || !form.title.trim()) return;
    setBooks(prev => prev.map(b => {
      if (b.id !== editingBook) return b;
      return {
        ...b,
        title: form.title.trim(),
        author: form.author.trim(),
        dewey: form.dewey.trim(),
        tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
        letterRange: form.letterRange.trim(),
      };
    }));
    setEditingBook(null);
    setForm(emptyForm);
    setView("book");
  };

  const startEdit = (book) => {
    setForm({
      title: book.title,
      author: book.author || "",
      dewey: book.dewey || "",
      tags: (book.tags || []).join(", "),
      letterRange: book.letterRange || "",
    });
    setEditingBook(book.id);
    setView("edit");
  };

  const deleteBook = (id) => {
    setBooks(prev => prev.filter(b => b.id !== id));
    setImages(prev => prev.filter(img => img.bookId !== id));
    if (activeBookId === id) { setView("library"); setActiveBookId(null); }
  };

  // ── Word Actions ──
  const addWord = () => {
    if (!activeBook || !activeLetter || !wordInput.trim()) return;
    const raw = wordInput.trim();

    // Check for see-also: "word → target" or "word -> target"
    const arrowMatch = raw.match(/^(.+?)\s*(?:→|->)\s*(.+)$/);

    setBooks(prev => prev.map(b => {
      if (b.id !== activeBookId) return b;
      const letters = { ...b.letters };
      if (!letters[activeLetter]) letters[activeLetter] = { words: [], notes: "" };
      const words = [...letters[activeLetter].words];
      let links = [...(b.links || [])];

      if (arrowMatch) {
        const fromWord = arrowMatch[1].trim().toLowerCase();
        const toWord = arrowMatch[2].trim().toLowerCase();
        if (fromWord && !words.includes(fromWord)) words.push(fromWord);
        if (!links.some(l => l.from === fromWord && l.to === toWord)) {
          links.push({ from: fromWord, to: toWord });
        }
      } else {
        raw.split(",").forEach(w => {
          const trimmed = w.trim().toLowerCase();
          if (trimmed && !words.includes(trimmed)) words.push(trimmed);
        });
      }

      letters[activeLetter] = { ...letters[activeLetter], words };
      return { ...b, letters, links };
    }));
    setWordInput("");
    wordRef.current?.focus();
  };

  const removeWord = (letter, word) => {
    setBooks(prev => prev.map(b => {
      if (b.id !== activeBookId) return b;
      const letters = { ...b.letters };
      if (!letters[letter]) return b;
      letters[letter] = { ...letters[letter], words: letters[letter].words.filter(w => w !== word) };
      if (letters[letter].words.length === 0) delete letters[letter];
      // Also remove links involving this word
      const links = (b.links || []).filter(l => l.from !== word && l.to !== word);
      return { ...b, letters, links };
    }));
  };

  // ── Link Actions ──
  const addLink = () => {
    if (!activeBook || !linkFrom || !linkTo.trim()) return;
    const to = linkTo.trim().toLowerCase();
    setBooks(prev => prev.map(b => {
      if (b.id !== activeBookId) return b;
      const links = [...(b.links || [])];
      if (!links.some(l => l.from === linkFrom && l.to === to)) {
        links.push({ from: linkFrom, to: to });
      }
      return { ...b, links };
    }));
    setLinkFrom(null);
    setLinkTo("");
    setLinkMode(false);
  };

  const removeLink = (from, to) => {
    setBooks(prev => prev.map(b => {
      if (b.id !== activeBookId) return b;
      return { ...b, links: (b.links || []).filter(l => !(l.from === from && l.to === to)) };
    }));
  };

  // ── Image Actions ──
  const handleImageUpload = async (e) => {
    if (!activeBook) return;
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    for (const file of files) {
      try {
        const data = await compressImage(file);
        const img = {
          id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
          bookId: activeBook.id,
          data,
          letters: [], // which letters this image covers
          name: file.name,
          added: new Date().toISOString(),
        };
        setImages(prev => [...prev, img]);
        setImgTagging(img.id); // open tagging immediately
      } catch (err) {
        console.error("Image upload failed", err);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const toggleImageLetter = (imgId, letter) => {
    setImages(prev => prev.map(img => {
      if (img.id !== imgId) return img;
      const letters = img.letters.includes(letter)
        ? img.letters.filter(l => l !== letter)
        : [...img.letters, letter].sort();
      return { ...img, letters };
    }));
  };

  const deleteImage = (imgId) => {
    setImages(prev => prev.filter(img => img.id !== imgId));
    if (imgTagging === imgId) setImgTagging(null);
    if (imgExpanded === imgId) setImgExpanded(null);
  };

  const bookImages = activeBook ? images.filter(img => img.bookId === activeBook.id) : [];
  const letterImages = (activeLetter && activeBook)
    ? images.filter(img => img.bookId === activeBook.id && img.letters.includes(activeLetter))
    : [];

  // ── Patterns ──
  const patterns = useMemo(() => {
    const wordMap = {};
    books.forEach(b => {
      Object.entries(b.letters || {}).forEach(([letter, data]) => {
        (data.words || []).forEach(word => {
          if (!wordMap[word]) wordMap[word] = [];
          wordMap[word].push({ bookId: b.id, bookTitle: b.title, letter });
        });
      });
    });

    const crossBook = Object.entries(wordMap)
      .filter(([_, apps]) => new Set(apps.map(a => a.bookId)).size >= 2)
      .sort((a, b) => new Set(b[1].map(x => x.bookId)).size - new Set(a[1].map(x => x.bookId)).size);

    // All see-also links across all books
    const allLinks = [];
    books.forEach(b => {
      (b.links || []).forEach(l => {
        allLinks.push({ ...l, bookId: b.id, bookTitle: b.title });
      });
    });

    // Cross-book link bridges: where a see-also target appears in another book
    const linkBridges = [];
    allLinks.forEach(link => {
      const targetBooks = books.filter(b =>
        b.id !== link.bookId &&
        Object.values(b.letters || {}).some(data => data.words?.includes(link.to))
      );
      if (targetBooks.length > 0) {
        linkBridges.push({ ...link, targetBooks: targetBooks.map(b => b.title) });
      }
    });

    const totalWords = Object.keys(wordMap).length;
    const totalLinks = allLinks.length;

    return { crossBook, allLinks, linkBridges, totalWords, totalLinks, wordMap };
  }, [books]);

  const bookStats = useCallback((book) => {
    const lk = Object.keys(book.letters || {});
    const wc = lk.reduce((s, l) => s + (book.letters[l]?.words?.length || 0), 0);
    const ic = images.filter(img => img.bookId === book.id).length;
    return { letters: lk.length, words: wc, links: (book.links || []).length, images: ic };
  }, [images]);

  const filtered = search
    ? books.filter(b =>
        b.title.toLowerCase().includes(search.toLowerCase()) ||
        (b.author || "").toLowerCase().includes(search.toLowerCase()) ||
        (b.dewey || "").includes(search) ||
        (b.tags || []).some(t => t.toLowerCase().includes(search.toLowerCase()))
      )
    : books;

  // Helper: get links for a specific word in active book
  const linksForWord = (word) => {
    if (!activeBook) return [];
    return (activeBook.links || []).filter(l => l.from === word || l.to === word);
  };

  if (!loaded) return (
    <div style={{ ...S.root, display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ display:"flex", gap:4, justifyContent:"center", marginBottom:12 }}>
          {RAINBOW.map((c,i) => <div key={i} style={{ width:8, height:8, borderRadius:"50%", background:c, animation:`pulse 1.2s ease ${i*0.1}s infinite` }} />)}
        </div>
        <span style={{ fontFamily:"'Source Serif 4',Georgia,serif", color:"#8B8580" }}>Loading...</span>
      </div>
      <style>{`@keyframes pulse { 0%,100% { opacity:0.3; transform:scale(0.8); } 50% { opacity:1; transform:scale(1.2); } }`}</style>
    </div>
  );

  const nav = (to, bookId=null) => {
    setView(to);
    if (bookId !== undefined) setActiveBookId(bookId);
    setActiveLetter(null);
    setLinkMode(false);
    setLinkFrom(null);
    setImgTagging(null);
    setImgExpanded(null);
  };

  return (
    <div style={S.root}>
      <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* ── Rainbow bar ── */}
      <div style={{ height:3, background:`linear-gradient(90deg, ${RAINBOW.join(", ")})` }} />

      {/* ── Header ── */}
      <header style={S.header}>
        <div style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }} onClick={() => nav("library", null)}>
          <div style={{ display:"flex", gap:3 }}>
            {RAINBOW.slice(0,4).map((c,i) => <div key={i} style={{ width:8, height:8, borderRadius:"50%", background:c }} />)}
          </div>
          <h1 style={S.logo}>Neural Shelf</h1>
          <span style={S.badge}>indexing studio</span>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {view !== "patterns" && books.length > 0 && (
            <button onClick={() => nav("patterns")} style={S.ghostBtn}>
              <span style={{ fontSize:14 }}>◇</span> Patterns
            </button>
          )}
          {view !== "library" && (
            <button onClick={() => nav("library", null)} style={S.ghostBtn}>Library</button>
          )}
          <button onClick={() => { setForm(emptyForm); setEditingBook(null); nav("add"); }} style={S.primaryBtn}>+ Add Book</button>
        </div>
      </header>

      {/* ── ADD / EDIT BOOK ── */}
      {(view === "add" || view === "edit") && (
        <div style={S.content}>
          <div style={S.card}>
            <h2 style={S.cardTitle}>{view === "edit" ? "Edit Book" : "New Book"}</h2>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <div>
                <label style={S.label}>Title *</label>
                <input style={S.input} placeholder="Book title" value={form.title}
                  onChange={e => setForm(f => ({...f, title:e.target.value}))}
                  onKeyDown={e => e.key === "Enter" && form.title.trim() && (view === "edit" ? updateBook() : addBook())}
                  autoFocus />
              </div>
              <div>
                <label style={S.label}>Author</label>
                <input style={S.input} placeholder="Author name" value={form.author}
                  onChange={e => setForm(f => ({...f, author:e.target.value}))} />
              </div>
              <div style={{ display:"flex", gap:10 }}>
                <div style={{ flex:1 }}>
                  <label style={S.label}>Dewey Number</label>
                  <input style={S.input} placeholder="e.g. 153.9" value={form.dewey}
                    onChange={e => setForm(f => ({...f, dewey:e.target.value}))} />
                  {form.dewey && (
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:6 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:deweyColor(form.dewey) }} />
                      <span style={{ ...S.muted, fontSize:12 }}>{deweyLabel(form.dewey)}</span>
                    </div>
                  )}
                </div>
                <div style={{ flex:1 }}>
                  <label style={S.label}>Letters Indexed</label>
                  <input style={S.input} placeholder="e.g. A-L or A-Z" value={form.letterRange}
                    onChange={e => setForm(f => ({...f, letterRange:e.target.value}))} />
                </div>
              </div>
              <div>
                <label style={S.label}>Subject Tags</label>
                <input style={S.input} placeholder="Comma-separated, e.g. psychology, cognition, learning"
                  value={form.tags} onChange={e => setForm(f => ({...f, tags:e.target.value}))} />
                {form.tags && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:8 }}>
                    {form.tags.split(",").map(t => t.trim()).filter(Boolean).map((tag,i) => (
                      <span key={i} style={{ ...S.tagPill, background:`${RAINBOW[i % RAINBOW.length]}18`, color:RAINBOW[i % RAINBOW.length], borderColor:`${RAINBOW[i % RAINBOW.length]}30` }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:16 }}>
              <button onClick={view === "edit" ? updateBook : addBook} style={S.primaryBtn}
                disabled={!form.title.trim()}>
                {view === "edit" ? "Save Changes" : "Add Book"}
              </button>
              <button onClick={() => nav(editingBook ? "book" : "library")} style={S.ghostBtn}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── LIBRARY ── */}
      {view === "library" && (
        <div style={S.content}>
          {books.length > 3 && (
            <input style={{ ...S.input, marginBottom:16 }} placeholder="Search by title, author, Dewey, or tag..."
              value={search} onChange={e => setSearch(e.target.value)} />
          )}

          {books.length === 0 && (
            <div style={{ textAlign:"center", padding:"60px 20px" }}>
              <div style={{ display:"flex", gap:4, justifyContent:"center", marginBottom:16 }}>
                {RAINBOW.map((c,i) => <div key={i} style={{ width:10, height:10, borderRadius:"50%", background:c, opacity:0.6 }} />)}
              </div>
              <p style={{ fontFamily:"'Source Serif 4',Georgia,serif", fontSize:18, color:"#2C2C2C", margin:"0 0 6px" }}>No books yet</p>
              <p style={{ ...S.muted, fontSize:13 }}>Add a book and start indexing.</p>
            </div>
          )}

          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {filtered.map(book => {
              const stats = bookStats(book);
              const dc = deweyColor(book.dewey);
              return (
                <div key={book.id} onClick={() => { setActiveBookId(book.id); nav("book", book.id); }}
                  style={{ ...S.bookCard, borderLeft:`3px solid ${dc}` }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
                      {book.dewey && (
                        <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:dc, fontWeight:600 }}>
                          {book.dewey}
                        </span>
                      )}
                      {book.dewey && <span style={{ color:"#D0CBC4", fontSize:11 }}>·</span>}
                      <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#A09890" }}>
                        {deweyLabel(book.dewey) || "Unclassified"}
                      </span>
                    </div>
                    <div style={S.bookTitle}>{book.title}</div>
                    {book.author && <div style={S.bookAuthor}>{book.author}</div>}
                    {(book.tags || []).length > 0 && (
                      <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginTop:6 }}>
                        {book.tags.map((tag,i) => (
                          <span key={i} style={{ ...S.tagPillSmall, background:`${RAINBOW[i % RAINBOW.length]}12`, color:RAINBOW[i % RAINBOW.length] }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4, flexShrink:0 }}>
                    {book.letterRange && (
                      <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#B0A8A0", fontWeight:500 }}>
                        {book.letterRange}
                      </span>
                    )}
                    <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#8B8580" }}>
                      {stats.words} words
                    </span>
                    {stats.links > 0 && (
                      <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#B0A8A0" }}>
                        {stats.links} links
                      </span>
                    )}
                    {stats.images > 0 && (
                      <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#B0A8A0" }}>
                        {stats.images} 📷
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {filtered.length === 0 && books.length > 0 && (
            <p style={{ ...S.muted, textAlign:"center", padding:20 }}>No books match "{search}"</p>
          )}
        </div>
      )}

      {/* ── BOOK DETAIL ── */}
      {view === "book" && activeBook && (
        <div style={S.content}>
          {/* Book header */}
          <div style={{ marginBottom:24 }}>
            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
              <div style={{ flex:1 }}>
                {activeBook.dewey && (
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:deweyColor(activeBook.dewey) }} />
                    <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:deweyColor(activeBook.dewey), fontWeight:600 }}>
                      {activeBook.dewey}
                    </span>
                    <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#A09890" }}>
                      {deweyLabel(activeBook.dewey)}
                    </span>
                  </div>
                )}
                <h2 style={{ fontFamily:"'Source Serif 4',Georgia,serif", fontSize:22, fontWeight:700, color:"#1C1C28", margin:0 }}>
                  {activeBook.title}
                </h2>
                {activeBook.author && <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:14, color:"#8B8580", margin:"4px 0 0" }}>{activeBook.author}</p>}
              </div>
              <button onClick={() => startEdit(activeBook)} style={{ ...S.ghostBtn, fontSize:11, padding:"4px 10px" }}>Edit</button>
            </div>
            {/* Tags + range */}
            <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:6, marginTop:10 }}>
              {activeBook.letterRange && (
                <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#A09890", background:"#F0EDE6", padding:"3px 10px", borderRadius:10 }}>
                  {activeBook.letterRange}
                </span>
              )}
              {(activeBook.tags || []).map((tag,i) => (
                <span key={i} style={{ ...S.tagPill, background:`${RAINBOW[i % RAINBOW.length]}15`, color:RAINBOW[i % RAINBOW.length], borderColor:`${RAINBOW[i % RAINBOW.length]}25` }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Index images */}
          <div style={{ marginBottom:20 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
              <p style={{ ...S.label, margin:0 }}>Index Images</p>
              <label style={{ ...S.ghostBtn, fontSize:11, padding:"4px 12px", cursor:"pointer", display:"inline-flex", alignItems:"center", gap:4 }}>
                <span style={{ fontSize:14 }}>+</span> Upload
                <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleImageUpload}
                  style={{ display:"none" }} />
              </label>
            </div>

            {bookImages.length === 0 && (
              <div style={{ border:"1px dashed #DDD8D0", borderRadius:10, padding:"20px", textAlign:"center", cursor:"pointer" }}
                onClick={() => fileRef.current?.click()}>
                <p style={{ ...S.muted, fontSize:12, margin:0 }}>Upload photos of your index pages</p>
                <p style={{ ...S.muted, fontSize:11, margin:"4px 0 0", color:"#C0B8A8" }}>Tag them to specific letters or leave untagged for the whole book</p>
              </div>
            )}

            {bookImages.length > 0 && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {bookImages.map(img => {
                  const isTagging = imgTagging === img.id;
                  const isExpanded = imgExpanded === img.id;
                  return (
                    <div key={img.id} style={{ position:"relative", flexShrink:0 }}>
                      {/* Thumbnail */}
                      <div style={{
                        width: isExpanded ? "100%" : 120, maxWidth: isExpanded ? 600 : 120,
                        borderRadius:10, overflow:"hidden", border:"1px solid #EEEAE2",
                        cursor:"pointer", transition:"all 0.2s ease",
                        background:"#FFF",
                      }}>
                        <img src={img.data} alt={img.name}
                          onClick={() => setImgExpanded(isExpanded ? null : img.id)}
                          style={{ width:"100%", display:"block", borderRadius: isExpanded ? "10px 10px 0 0" : 10 }} />

                        {/* Letter tags shown on thumbnail */}
                        {img.letters.length > 0 && !isExpanded && (
                          <div style={{ position:"absolute", bottom:4, left:4, display:"flex", gap:2, flexWrap:"wrap" }}>
                            {img.letters.map(l => (
                              <span key={l} style={{
                                fontFamily:"'DM Sans',sans-serif", fontSize:9, fontWeight:700,
                                color:"#FFF", background:letterColor(l),
                                width:16, height:16, borderRadius:4,
                                display:"inline-flex", alignItems:"center", justifyContent:"center",
                                boxShadow:"0 1px 3px rgba(0,0,0,0.2)",
                              }}>{l}</span>
                            ))}
                          </div>
                        )}

                        {img.letters.length === 0 && !isExpanded && (
                          <div style={{ position:"absolute", bottom:4, left:4 }}>
                            <span style={{
                              fontFamily:"'DM Sans',sans-serif", fontSize:9,
                              color:"#FFF", background:"rgba(0,0,0,0.4)",
                              padding:"2px 6px", borderRadius:4,
                            }}>untagged</span>
                          </div>
                        )}

                        {/* Expanded view with controls */}
                        {isExpanded && (
                          <div style={{ padding:"12px 14px" }}>
                            <p style={{ ...S.label, marginBottom:8 }}>Tag letters this image covers</p>
                            <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginBottom:10 }}>
                              {LETTERS.map(letter => {
                                const tagged = img.letters.includes(letter);
                                const lc = letterColor(letter);
                                return (
                                  <button key={letter} onClick={() => toggleImageLetter(img.id, letter)}
                                    style={{
                                      width:28, height:28, borderRadius:6, border:"none",
                                      fontFamily:"'DM Sans',sans-serif", fontSize:11, fontWeight:600,
                                      cursor:"pointer",
                                      background: tagged ? lc : "#F5F3EE",
                                      color: tagged ? "#FFF" : "#C8C0B4",
                                      transition:"all 0.1s ease",
                                    }}>
                                    {letter}
                                  </button>
                                );
                              })}
                            </div>
                            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                              {img.letters.length > 0 && (
                                <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#8B8580" }}>
                                  Tagged: {img.letters.join(", ")}
                                </span>
                              )}
                              <button onClick={() => deleteImage(img.id)}
                                style={{ ...S.ghostBtn, fontSize:10, padding:"3px 8px", color:"#C0A0A0", marginLeft:"auto" }}>
                                Remove image
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Letter grid */}
          <div style={{ marginBottom:20 }}>
            <p style={{ ...S.label, marginBottom:8 }}>Letters</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
              {LETTERS.map(letter => {
                const hasData = activeBook.letters?.[letter]?.words?.length > 0;
                const hasImg = images.some(img => img.bookId === activeBook.id && img.letters.includes(letter));
                const isActive = activeLetter === letter;
                const wc = activeBook.letters?.[letter]?.words?.length || 0;
                const lc = letterColor(letter);
                return (
                  <button key={letter} onClick={() => { setActiveLetter(isActive ? null : letter); setWordInput(""); setLinkMode(false); }}
                    style={{
                      width:36, height:36, borderRadius:8, border:"none",
                      fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:600,
                      cursor:"pointer", position:"relative",
                      transition:"all 0.15s ease",
                      background: isActive ? lc : hasData ? `${lc}15` : hasImg ? `${lc}08` : "#F5F3EE",
                      color: isActive ? "#FFF" : hasData ? lc : hasImg ? `${lc}90` : "#C8C0B4",
                      boxShadow: isActive ? `0 2px 10px ${lc}40` : "none",
                    }}>
                    {letter}
                    {hasData && !isActive && (
                      <span style={{ position:"absolute", top:3, right:3, width:5, height:5, borderRadius:"50%", background:lc }} />
                    )}
                    {hasImg && !isActive && (
                      <span style={{ position:"absolute", bottom:2, right:2, fontSize:7, lineHeight:1 }}>📷</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active letter panel */}
          {activeLetter && (
            <div style={{ ...S.card, borderLeft:`3px solid ${letterColor(activeLetter)}`, marginBottom:16 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                <span style={{ fontFamily:"'Source Serif 4',Georgia,serif", fontSize:28, fontWeight:700, color:letterColor(activeLetter), lineHeight:1 }}>
                  {activeLetter}
                </span>
                <span style={S.label}>{activeBook.letters?.[activeLetter]?.words?.length || 0} words</span>
              </div>

              {/* Word input */}
              <div style={{ display:"flex", gap:6, marginBottom:12 }}>
                <input ref={wordRef} style={{ ...S.input, flex:1 }}
                  placeholder="Type a word, or word → see also target..."
                  value={wordInput}
                  onChange={e => setWordInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addWord()}
                  autoFocus />
                <button onClick={addWord} style={S.primaryBtn} disabled={!wordInput.trim()}>Add</button>
              </div>
              {wordInput.includes("→") || wordInput.includes("->") ? (
                <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#4FC1C9", margin:"-6px 0 10px", fontStyle:"italic" }}>
                  ↳ Will create a see-also link
                </p>
              ) : null}

              {/* Images tagged to this letter */}
              {letterImages.length > 0 && (
                <div style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:4 }}>
                    {letterImages.map(img => (
                      <img key={img.id} src={img.data} alt={img.name}
                        onClick={() => setImgExpanded(imgExpanded === img.id ? null : img.id)}
                        style={{
                          height:80, borderRadius:8, border:"1px solid #EEEAE2",
                          cursor:"pointer", flexShrink:0, objectFit:"cover",
                          opacity: imgExpanded === img.id ? 1 : 0.85,
                          transition:"opacity 0.15s ease",
                        }} />
                    ))}
                  </div>
                </div>
              )}

              {/* Words */}
              <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                {(activeBook.letters?.[activeLetter]?.words || []).map(word => {
                  const inOther = books.filter(b => b.id !== activeBookId && Object.values(b.letters || {}).some(l => l.words?.includes(word)));
                  const isShared = inOther.length > 0;
                  const wLinks = linksForWord(word);
                  const hasLinks = wLinks.length > 0;
                  const wc = wordColor(word);

                  return (
                    <span key={word} style={{
                      fontFamily:"'DM Sans',sans-serif", fontSize:13,
                      padding:"4px 10px", borderRadius:14,
                      background: isShared ? "#FFF8E1" : `${wc}10`,
                      color: isShared ? "#8B7530" : "#2C2C2C",
                      border: isShared ? "1px solid #F5C54240" : `1px solid ${wc}20`,
                      display:"inline-flex", alignItems:"center", gap:5,
                      cursor:"default", position:"relative",
                    }}
                    title={[
                      isShared ? `Also in: ${inOther.map(b => b.title).join(", ")}` : "",
                      hasLinks ? `Links: ${wLinks.map(l => l.from === word ? `→ ${l.to}` : `← ${l.from}`).join(", ")}` : "",
                    ].filter(Boolean).join("\n")}>
                      {isShared && <span style={{ fontSize:10 }}>🔗</span>}
                      {hasLinks && !isShared && <span style={{ fontSize:10, color:"#4FC1C9" }}>↔</span>}
                      {word}
                      {hasLinks && (
                        <span style={{ fontSize:10, color:"#A09890" }}>
                          {wLinks.filter(l => l.from === word).map(l => `→${l.to}`).join(" ")}
                        </span>
                      )}
                      <span onClick={e => { e.stopPropagation(); removeWord(activeLetter, word); }}
                        style={{ cursor:"pointer", color:"#C0B8A8", fontSize:13, marginLeft:1, lineHeight:1 }}>×</span>
                    </span>
                  );
                })}
              </div>
              {(activeBook.letters?.[activeLetter]?.words || []).length === 0 && (
                <p style={{ ...S.muted, fontSize:12 }}>No words yet. Type above to add, or use → for see-also links.</p>
              )}
            </div>
          )}

          {/* See-also links for this book */}
          {(activeBook.links || []).length > 0 && (
            <div style={{ ...S.card, borderLeft:"3px solid #4FC1C9", marginBottom:16 }}>
              <p style={{ ...S.label, marginBottom:10, color:"#4FC1C9" }}>See-Also Links</p>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {(activeBook.links || []).map((link, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:8, fontFamily:"'DM Sans',sans-serif", fontSize:13 }}>
                    <span style={{ color:"#2C2C2C", fontWeight:500 }}>{link.from}</span>
                    <span style={{ color:"#4FC1C9", fontSize:16 }}>→</span>
                    <span style={{ color:"#2C2C2C" }}>{link.to}</span>
                    <span onClick={() => removeLink(link.from, link.to)}
                      style={{ cursor:"pointer", color:"#C0B8A8", fontSize:12, marginLeft:"auto" }}>remove</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manual link creation */}
          {linkMode ? (
            <div style={{ ...S.card, background:"#F0FCFC", border:"1px solid #4FC1C920", marginBottom:16 }}>
              <p style={{ ...S.label, marginBottom:8, color:"#4FC1C9" }}>Create a see-also link</p>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <input style={{ ...S.input, flex:1 }} placeholder="From word..." value={linkFrom || ""}
                  onChange={e => setLinkFrom(e.target.value.toLowerCase())} />
                <span style={{ color:"#4FC1C9", fontWeight:700 }}>→</span>
                <input style={{ ...S.input, flex:1 }} placeholder="To word..." value={linkTo}
                  onChange={e => setLinkTo(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addLink()} />
                <button onClick={addLink} style={S.primaryBtn} disabled={!linkFrom || !linkTo.trim()}>Link</button>
              </div>
              <button onClick={() => { setLinkMode(false); setLinkFrom(null); setLinkTo(""); }}
                style={{ ...S.ghostBtn, marginTop:8, fontSize:11, padding:"4px 10px" }}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => setLinkMode(true)}
              style={{ ...S.ghostBtn, fontSize:12, color:"#4FC1C9", borderColor:"#4FC1C930", marginBottom:16 }}>
              + Add see-also link
            </button>
          )}

          {/* All words overview (when no letter selected) */}
          {!activeLetter && Object.keys(activeBook.letters || {}).length > 0 && (
            <div style={S.card}>
              <p style={{ ...S.label, marginBottom:10 }}>All captured words</p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                {Object.entries(activeBook.letters || {}).sort().map(([letter, data]) =>
                  (data.words || []).map(word => {
                    const isShared = books.some(b => b.id !== activeBookId && Object.values(b.letters || {}).some(l => l.words?.includes(word)));
                    const lc = letterColor(letter);
                    return (
                      <span key={`${letter}-${word}`} style={{
                        fontFamily:"'DM Sans',sans-serif", fontSize:12,
                        padding:"3px 9px", borderRadius:12,
                        background: isShared ? "#FFF8E1" : `${lc}10`,
                        color: isShared ? "#8B7530" : "#555",
                        border: isShared ? "1px solid #F5C54230" : "none",
                      }}>
                        <span style={{ fontSize:10, color:lc, fontWeight:700, marginRight:3 }}>{letter}</span>
                        {word}
                        {isShared && <span style={{ fontSize:9, marginLeft:3 }}>🔗</span>}
                      </span>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Delete */}
          <button onClick={() => { if (confirm(`Remove "${activeBook.title}" from your library?`)) deleteBook(activeBook.id); }}
            style={{ ...S.ghostBtn, color:"#C0A0A0", marginTop:16, fontSize:11 }}>
            Remove this book
          </button>
        </div>
      )}

      {/* ── PATTERNS ── */}
      {view === "patterns" && (
        <div style={S.content}>
          <h2 style={{ fontFamily:"'Source Serif 4',Georgia,serif", fontSize:22, fontWeight:700, color:"#1C1C28", marginBottom:20 }}>
            Patterns
          </h2>

          {/* Stats */}
          <div style={{ display:"flex", gap:10, marginBottom:24, flexWrap:"wrap" }}>
            {[
              { n:books.length, label:"Books", color:RAINBOW[0] },
              { n:patterns.totalWords, label:"Unique Words", color:RAINBOW[2] },
              { n:patterns.crossBook.length, label:"Cross-Book", color:RAINBOW[4] },
              { n:patterns.totalLinks, label:"See-Also Links", color:RAINBOW[6] },
            ].map((s,i) => (
              <div key={i} style={{ flex:"1 1 100px", background:"#FFF", border:"1px solid #EEEAE2", borderRadius:12, padding:"14px 16px", textAlign:"center", borderTop:`3px solid ${s.color}` }}>
                <div style={{ fontFamily:"'Source Serif 4',Georgia,serif", fontSize:26, fontWeight:700, color:"#1C1C28" }}>{s.n}</div>
                <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#8B8580", fontWeight:500 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Cross-book words */}
          {patterns.crossBook.length > 0 && (
            <div style={{ ...S.card, borderLeft:"3px solid #F5C542", marginBottom:16 }}>
              <p style={{ ...S.label, marginBottom:12, color:"#C4A030" }}>Words appearing across multiple books</p>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {patterns.crossBook.map(([word, appearances]) => {
                  const uniqueBooks = [...new Set(appearances.map(a => a.bookTitle))];
                  return (
                    <div key={word}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontFamily:"'Source Serif 4',Georgia,serif", fontSize:15, fontWeight:600, color:"#2C2C2C" }}>{word}</span>
                        <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#F5C542", fontWeight:600, background:"#FFF8E1", padding:"2px 8px", borderRadius:8 }}>
                          {uniqueBooks.length} books
                        </span>
                      </div>
                      <div style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#8B8580", marginTop:3 }}>
                        {uniqueBooks.join(" · ")}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Link bridges: see-also targets that appear in other books */}
          {patterns.linkBridges.length > 0 && (
            <div style={{ ...S.card, borderLeft:"3px solid #4FC1C9", marginBottom:16 }}>
              <p style={{ ...S.label, marginBottom:12, color:"#4FC1C9" }}>See-also bridges across books</p>
              <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:12, color:"#8B8580", marginBottom:12 }}>
                A see-also target in one book appears as an indexed word in another.
              </p>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {patterns.linkBridges.map((bridge, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                    <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:600, color:"#2C2C2C" }}>{bridge.from}</span>
                    <span style={{ color:"#4FC1C9" }}>→</span>
                    <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:600, color:"#2C2C2C" }}>{bridge.to}</span>
                    <span style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#8B8580" }}>
                      in <em>{bridge.bookTitle}</em> · also indexed in <em>{bridge.targetBooks.join(", ")}</em>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All see-also links */}
          {patterns.allLinks.length > 0 && (
            <div style={{ ...S.card, marginBottom:16 }}>
              <p style={{ ...S.label, marginBottom:10 }}>All see-also links</p>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {patterns.allLinks.map((link, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:8, fontFamily:"'DM Sans',sans-serif", fontSize:12 }}>
                    <span style={{ fontWeight:500, color:"#2C2C2C" }}>{link.from}</span>
                    <span style={{ color:"#4FC1C9" }}>→</span>
                    <span style={{ color:"#2C2C2C" }}>{link.to}</span>
                    <span style={{ color:"#B0A8A0", fontSize:11, marginLeft:"auto" }}>{link.bookTitle}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {patterns.crossBook.length === 0 && books.length >= 2 && (
            <div style={{ ...S.card, textAlign:"center" }}>
              <p style={S.muted}>No cross-book patterns yet. Keep indexing — connections will surface.</p>
            </div>
          )}
          {books.length < 2 && (
            <div style={{ ...S.card, textAlign:"center" }}>
              <p style={S.muted}>Index 2+ books to start seeing patterns emerge.</p>
            </div>
          )}

          {/* Word frequency */}
          {Object.keys(patterns.wordMap).length > 0 && (
            <div style={{ ...S.card, marginTop:4 }}>
              <p style={{ ...S.label, marginBottom:10 }}>Word cloud by frequency</p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                {Object.entries(patterns.wordMap)
                  .sort((a,b) => b[1].length - a[1].length)
                  .slice(0, 100)
                  .map(([word, apps]) => {
                    const freq = apps.length;
                    const isMulti = new Set(apps.map(a => a.bookId)).size > 1;
                    const wc = wordColor(word);
                    return (
                      <span key={word} style={{
                        fontFamily:"'DM Sans',sans-serif",
                        fontSize: freq > 3 ? 15 : freq > 1 ? 13 : 11,
                        fontWeight: freq > 2 ? 600 : 400,
                        padding:"2px 8px", borderRadius:10,
                        background: isMulti ? "#FFF8E1" : `${wc}08`,
                        color: isMulti ? "#8B7530" : "#8B8580",
                        border: isMulti ? "1px solid #F5C54225" : "none",
                      }}>{word}</span>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{ marginTop:40, padding:"24px 20px", background:"#1C1C28", textAlign:"center" }}>
        <div style={{ display:"flex", gap:4, justifyContent:"center", marginBottom:10 }}>
          {RAINBOW.map((c,i) => <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:c, opacity:0.7 }} />)}
        </div>
        <p style={{ fontFamily:"'Source Serif 4',Georgia,serif", fontSize:14, color:"#A0A0B0", margin:0 }}>
          Neural Shelf · Indexing Studio
        </p>
        <p style={{ fontFamily:"'DM Sans',sans-serif", fontSize:11, color:"#606070", margin:"4px 0 0" }}>
          Knowledge Architecture · Index Mining · Learning Design
        </p>
      </div>
    </div>
  );
}

// ── Styles ──
const S = {
  root: {
    width:"100vw", minHeight:"100vh",
    background:"#FAFAF7",
    fontFamily:"'DM Sans',sans-serif",
  },
  header: {
    display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"14px 20px", borderBottom:"1px solid #EEEAE2",
    flexWrap:"wrap", gap:10, background:"#FFF",
  },
  logo: {
    fontFamily:"'Source Serif 4',Georgia,serif", fontSize:18,
    fontWeight:700, color:"#1C1C28", margin:0, cursor:"pointer",
  },
  badge: {
    fontFamily:"'DM Sans',sans-serif", fontSize:10, fontWeight:600,
    color:"#A09890", textTransform:"uppercase", letterSpacing:"0.08em",
    background:"#F0EDE6", padding:"2px 8px", borderRadius:6,
  },
  content: { maxWidth:680, margin:"0 auto", padding:"24px 20px" },
  card: {
    background:"#FFF", border:"1px solid #EEEAE2",
    borderRadius:12, padding:"18px 20px", marginBottom:12,
  },
  cardTitle: {
    fontFamily:"'Source Serif 4',Georgia,serif",
    fontSize:18, fontWeight:600, color:"#1C1C28",
    margin:"0 0 16px 0",
  },
  input: {
    fontFamily:"'DM Sans',sans-serif", fontSize:14,
    color:"#2C2C2C", background:"#FAFAF7",
    border:"1px solid #E0DCD4", borderRadius:8,
    padding:"10px 14px", width:"100%",
    outline:"none", boxSizing:"border-box",
    transition:"border-color 0.15s ease",
  },
  label: {
    fontFamily:"'DM Sans',sans-serif", fontSize:11,
    fontWeight:600, color:"#A09890",
    textTransform:"uppercase", letterSpacing:"0.06em",
    display:"block", marginBottom:6,
  },
  muted: {
    fontFamily:"'DM Sans',sans-serif", fontSize:13,
    color:"#A09890",
  },
  primaryBtn: {
    fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:600,
    color:"#FFF", background:"#1C1C28",
    border:"none", borderRadius:8, padding:"9px 18px",
    cursor:"pointer", whiteSpace:"nowrap",
    transition:"background 0.15s ease",
  },
  ghostBtn: {
    fontFamily:"'DM Sans',sans-serif", fontSize:12, fontWeight:500,
    color:"#8B8580", background:"transparent",
    border:"1px solid #E0DCD4", borderRadius:8, padding:"7px 14px",
    cursor:"pointer", whiteSpace:"nowrap",
    transition:"all 0.15s ease",
  },
  bookCard: {
    display:"flex", alignItems:"center", gap:14,
    padding:"14px 18px", borderRadius:10,
    background:"#FFF", border:"1px solid #EEEAE2",
    cursor:"pointer", transition:"all 0.15s ease",
  },
  bookTitle: {
    fontFamily:"'Source Serif 4',Georgia,serif",
    fontSize:16, fontWeight:600, color:"#1C1C28",
  },
  bookAuthor: {
    fontFamily:"'DM Sans',sans-serif", fontSize:13,
    color:"#A09890", marginTop:2,
  },
  tagPill: {
    fontFamily:"'DM Sans',sans-serif", fontSize:12, fontWeight:500,
    padding:"3px 10px", borderRadius:12,
    border:"1px solid transparent",
  },
  tagPillSmall: {
    fontFamily:"'DM Sans',sans-serif", fontSize:10, fontWeight:600,
    padding:"2px 7px", borderRadius:8,
    textTransform:"lowercase",
  },
};
