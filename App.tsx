import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, Wand2, Play, Pause, Scissors, Trash2, MousePointer2, Crop, RotateCw, Image as ImageIcon,
  Maximize, Minimize, Archive, X, RefreshCw, CheckSquare, Eraser, Settings2, Wind, Replace,
  Aperture, Layers, MoreVertical, Undo2, Redo2, Settings, Sun, Moon, Languages
} from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import JSZip from 'jszip';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { detectSprites, cropFrame } from './utils/spriteDetector';
import { SortableFrame } from './components/SortableFrame';
import { ImageProcessorModal } from './components/ImageProcessorModal';
import { Frame, ImageState, Rect, ToolMode } from './types';
import { v4 as uuidv4 } from 'uuid';
import { t, Lang } from './utils/i18n';

type Theme = 'light' | 'dark';

export default function App() {
  // Config State
  const [lang, setLang] = useState<Lang>('zh');
  const [theme, setTheme] = useState<Theme>('dark');
  
  // Ripple State
  const [ripple, setRipple] = useState<{x: number, y: number, active: boolean} | null>(null);

  // App State
  const [image, setImage] = useState<ImageState | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  // Ghost Frames are used for the "Fly from canvas to timeline" animation
  const [ghostFrames, setGhostFrames] = useState<Frame[]>([]); 
  
  // History State
  const [history, setHistory] = useState<Frame[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Selection State
  const [selectedFrameIds, setSelectedFrameIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  
  // Special Animation States
  const [isScanning, setIsScanning] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [previewWarp, setPreviewWarp] = useState<string | null>(null); // ID of frame warping to preview
  const [uploadOrigin, setUploadOrigin] = useState<{x:number, y:number} | null>(null);
  
  const isProcessing = isScanning || isRotating;

  // Config & Modals
  const [showDetectSettings, setShowDetectSettings] = useState(false);
  const detectBtnRef = useRef<HTMLDivElement>(null);
  const [detectIgnoreNested, setDetectIgnoreNested] = useState(true);
  const [detectMinArea, setDetectMinArea] = useState(64);
  const [contextMenu, setContextMenu] = useState<{x: number; y: number; targetId: string; selectionSnapshot: Set<string>;} | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [isFitToScreen, setIsFitToScreen] = useState(true);
  
  const [showExportModal, setShowExportModal] = useState(false);
  const [showRotateModal, setShowRotateModal] = useState(false);
  const [showProcessorModal, setShowProcessorModal] = useState(false);
  
  // Rotate Settings
  const [rotateFrameCount, setRotateFrameCount] = useState(8);
  const [rotateUseBlur, setRotateUseBlur] = useState(false);
  const [rotateReplace, setRotateReplace] = useState(true);
  const [rotateBlurAngle, setRotateBlurAngle] = useState(20);
  const [rotateBlurSamples, setRotateBlurSamples] = useState(10);
  
  // Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const [fps, setFps] = useState(8);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const isDrawing = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const [tempRect, setTempRect] = useState<Rect | null>(null);

  // Marquee
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{x: number, y: number, w: number, h: number} | null>(null);
  const selectionStart = useRef<{x: number, y: number} | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // --- Ripple Logic ---
  const triggerRipple = (e: React.MouseEvent, callback: () => void) => {
    setRipple({ x: e.clientX, y: e.clientY, active: true });
    // Toggle state halfway through animation (300ms)
    setTimeout(() => {
        callback();
    }, 250);
    // Reset ripple
    setTimeout(() => {
        setRipple(null);
    }, 700);
  };

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [theme]);

  // --- History & Standard Logic ---
  const commitFrames = useCallback((newFrames: Frame[], reset: boolean = false) => {
      setFrames(newFrames);
      if (reset) {
          setHistory([newFrames]); setHistoryIndex(0);
      } else {
          setHistory(prev => {
              const newHistory = prev.slice(0, historyIndex + 1);
              newHistory.push(newFrames);
              if (newHistory.length > 50) newHistory.shift();
              return newHistory;
          });
          setHistoryIndex(prev => (prev + 1 > 49 ? 49 : prev + 1));
      }
  }, [historyIndex]);

  const undo = () => { if (historyIndex > 0) { const newIndex = historyIndex - 1; setHistoryIndex(newIndex); setFrames(history[newIndex]); setSelectedFrameIds(new Set()); } };
  const redo = () => { if (historyIndex < history.length - 1) { const newIndex = historyIndex + 1; setHistoryIndex(newIndex); setFrames(history[newIndex]); setSelectedFrameIds(new Set()); } };

  // --- Complex Interaction Handlers ---

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Capture origin for animation
    const rect = e.target.getBoundingClientRect();
    if (rect.width === 0) setUploadOrigin({ x: window.innerWidth / 2, y: window.innerHeight / 2 }); // fallback
    
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage({ url, width: img.width, height: img.height, file });
      commitFrames([], true);
      setSelectedFrameIds(new Set());
      setIsFitToScreen(true);
    };
    img.src = url;
    e.target.value = '';
  };

  const handleUploadClick = (e: React.MouseEvent) => {
      setUploadOrigin({ x: e.clientX, y: e.clientY });
      document.getElementById('file-upload')?.click();
  };

  const handleImageUpdate = (newImageSrc: string) => {
      const img = new Image();
      img.onload = () => {
          setImage(prev => prev ? { ...prev, url: newImageSrc, width: img.width, height: img.height } : null);
          commitFrames([], true);
          setSelectedFrameIds(new Set());
          setShowProcessorModal(false);
      };
      img.src = newImageSrc;
  };

  const handleAutoDetect = async () => {
    if (!image) return;
    setIsScanning(true);
    setShowDetectSettings(false);
    
    // 1. Wait for Scan Animation (1s)
    await new Promise(r => setTimeout(r, 1000));
    
    try {
      const rects = await detectSprites(image.url, 10, detectIgnoreNested, detectMinArea);
      
      // Filter out rects that overlap significantly with existing frames
      const uniqueRects = rects.filter(newRect => {
        return !frames.some(existingFrame => {
           // Allow small margin of error (e.g., 4 pixels) to treat them as same frame
           const xDiff = Math.abs(newRect.x - existingFrame.x);
           const yDiff = Math.abs(newRect.y - existingFrame.y);
           const wDiff = Math.abs(newRect.width - existingFrame.width);
           const hDiff = Math.abs(newRect.height - existingFrame.height);
           return xDiff < 4 && yDiff < 4 && wDiff < 4 && hDiff < 4;
        });
      });

      if (uniqueRects.length === 0) {
        setIsScanning(false);
        // Could show a toast here saying "No new frames found"
        return;
      }

      const detectedFrames = await Promise.all(uniqueRects.map(async (rect, i) => ({
          ...rect, id: uuidv4(), order: frames.length + i, imageData: await cropFrame(image.url, rect)
      })));

      // 2. Put frames on "Ghost" layer (Canvas Overlay)
      setGhostFrames(detectedFrames);
      setIsScanning(false);

      // 3. Staggered Fly to Timeline
      // We do this by moving them from Ghost (Canvas) to Frames (Timeline) state
      // Framer Motion's LayoutGroup will handle the movement if keys match
      // But we need a slight delay to let the user see the boxes on canvas first
      setTimeout(() => {
          setGhostFrames([]);
          commitFrames([...frames, ...detectedFrames]);
      }, 500); 

    } catch (err) {
      console.error(err);
      setIsScanning(false);
    }
  };

  const handleGenerateRotation = async () => {
     let sourceFrame = frames.find(f => f.id === lastSelectedId) || frames.find(f => f.id === Array.from(selectedFrameIds)[0]);
     if (!sourceFrame?.imageData) return;
     setShowRotateModal(false);
     
     // 1. Trigger Rotate Animation on Source Frame (simulated by setting a state that the frame uses)
     setIsRotating(true);
     await new Promise(r => setTimeout(r, 800)); // Wait for spin
     
     // 2. Flash effect (Global white overlay)
     const flash = document.createElement('div');
     flash.className = "fixed inset-0 bg-white z-[100] pointer-events-none transition-opacity duration-300";
     document.body.appendChild(flash);
     setTimeout(() => flash.classList.add('opacity-0'), 50);
     setTimeout(() => flash.remove(), 350);

     try {
       const img = new Image(); img.src = sourceFrame.imageData;
       await new Promise(r => img.onload = r);
       const diagonal = Math.ceil(Math.sqrt(img.width**2 + img.height**2));
       const canvas = document.createElement('canvas'); canvas.width = diagonal; canvas.height = diagonal;
       const ctx = canvas.getContext('2d')!;
       const newFrames: Frame[] = [];
       for (let i = 0; i < rotateFrameCount; i++) {
         const angle = (360 / rotateFrameCount) * i;
         ctx.clearRect(0, 0, diagonal, diagonal);
         if (rotateUseBlur) {
             ctx.save(); ctx.translate(diagonal/2, diagonal/2); ctx.globalAlpha = 1/Math.max(1, rotateBlurSamples);
             for(let s=0; s<rotateBlurSamples; s++) {
                 ctx.save(); ctx.rotate(((angle - (s/rotateBlurSamples)*rotateBlurAngle) * Math.PI)/180);
                 ctx.drawImage(img, -img.width/2, -img.height/2); ctx.restore();
             }
             ctx.restore();
         } else {
             ctx.save(); ctx.translate(diagonal/2, diagonal/2); ctx.rotate((angle * Math.PI)/180);
             ctx.drawImage(img, -img.width/2, -img.height/2); ctx.restore();
         }
         newFrames.push({ id: uuidv4(), x:0, y:0, width:0, height:0, order: frames.length+i, imageData: canvas.toDataURL() });
       }
       
       // 3. Add to Ghost Frames for flight
       setGhostFrames(newFrames); // Note: These ghosts won't have canvas coords, they might pop from center
       // Actually, rotation ghosts should spawn from source frame location. 
       // For simplicity in this constraints, we let them fly from 0,0 or center.
       
       setTimeout(() => {
          let updated = [...frames];
          if (rotateReplace && sourceFrame) updated.splice(updated.findIndex(f => f.id === sourceFrame!.id), 1, ...newFrames);
          else updated.push(...newFrames);
          
          setGhostFrames([]);
          commitFrames(updated); 
          setSelectedFrameIds(new Set(newFrames.map(f => f.id)));
          setIsRotating(false);
       }, 500);

     } catch(e) { console.error(e); setIsRotating(false); }
  };

  const handlePlayClick = () => {
      if (isPlaying) {
          setIsPlaying(false);
          return;
      }
      // "Warp" effect: Find selected frame, distort it, move to preview
      if (selectedFrameIds.size > 0) {
          const firstId = Array.from(selectedFrameIds)[0];
          setPreviewWarp(firstId);
          setTimeout(() => {
              setPreviewWarp(null);
              setIsPlaying(true);
          }, 600); // Wait for warp animation
      } else {
          setIsPlaying(true);
      }
  };

  const performExport = async (format: 'png' | 'zip') => { /* Same as before */
    setShowExportModal(false);
    if (format === 'png' && frames[0]?.imageData) {
       const a = document.createElement('a'); a.href = frames[0].imageData; a.download = 'frame.png'; a.click();
    } else if (format === 'zip') {
       try {
         const zip = new JSZip();
         frames.forEach((f, i) => zip.file(`frame_${String(i+1).padStart(3,'0')}.png`, f.imageData!.split(',')[1], {base64:true}));
         const content = await zip.generateAsync({type:"blob"});
         const url = URL.createObjectURL(content);
         const a = document.createElement('a'); a.href = url; a.download = "sprites.zip"; a.click();
       } catch(e) { alert("Export failed"); }
    }
  };

  // Drawing Handlers
  const getMousePos = (e: React.MouseEvent) => {
    if (!containerRef.current || !image) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = image.width / rect.width;
    const scaleY = image.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!image || toolMode !== 'draw') return;
    isDrawing.current = true;
    const pos = getMousePos(e);
    startPos.current = pos;
    setTempRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing.current || !image) return;
    const pos = getMousePos(e);
    const x = Math.min(startPos.current.x, pos.x), y = Math.min(startPos.current.y, pos.y);
    setTempRect({ x, y, width: Math.abs(pos.x - startPos.current.x), height: Math.abs(pos.y - startPos.current.y) });
  };
  const handleMouseUp = async () => {
    if (!isDrawing.current || !image || !tempRect) return;
    isDrawing.current = false;
    if (tempRect.width > 5 && tempRect.height > 5) {
      const imageData = await cropFrame(image.url, tempRect);
      const newFrame = { ...tempRect, id: uuidv4(), order: frames.length, imageData };
      // Direct add for manual
      commitFrames([...frames, newFrame]); setSelectedFrameIds(new Set([newFrame.id])); setToolMode('select');
    }
    setTempRect(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setFrames((items) => arrayMove(items, items.findIndex(f => f.id === active.id), items.findIndex(f => f.id === over.id)));
    }
  };
  
  // Handlers for timeline/selection... (Condensed for brevity, same logic)
  const handleDeleteSelected = () => { commitFrames(frames.filter(f => !selectedFrameIds.has(f.id))); setSelectedFrameIds(new Set()); };
  const handleDeleteSingle = (id: string) => { commitFrames(frames.filter(f => f.id !== id)); if(selectedFrameIds.has(id)) { const s = new Set(selectedFrameIds); s.delete(id); setSelectedFrameIds(s); }};
  const handleFrameClick = (id: string, e: React.MouseEvent) => {
      e.stopPropagation(); setContextMenu(null);
      if (e.shiftKey && lastSelectedId) {
          const idx1 = frames.findIndex(f => f.id === lastSelectedId), idx2 = frames.findIndex(f => f.id === id);
          if (idx1 !== -1 && idx2 !== -1) {
              const start = Math.min(idx1, idx2), end = Math.max(idx1, idx2);
              const newSet = new Set(e.ctrlKey ? selectedFrameIds : []);
              for(let i=start; i<=end; i++) newSet.add(frames[i].id);
              setSelectedFrameIds(newSet);
          }
      } else if (e.ctrlKey) { const newSet = new Set(selectedFrameIds); newSet.has(id) ? newSet.delete(id) : newSet.add(id); setSelectedFrameIds(newSet); setLastSelectedId(id); } 
      else { setSelectedFrameIds(new Set([id])); setLastSelectedId(id); }
  };
  const handleTimelineMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.sortable-frame') || (e.target as HTMLElement).closest('button')) return;
    setIsSelecting(true); selectionStart.current = { x: e.clientX, y: e.clientY }; setSelectionBox({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  };
  useEffect(() => {
    if (!isSelecting) return;
    const onMove = (e: MouseEvent) => { if (selectionStart.current) { const sx = selectionStart.current.x, sy = selectionStart.current.y; setSelectionBox({ x: Math.min(sx, e.clientX), y: Math.min(sy, e.clientY), w: Math.abs(sx - e.clientX), h: Math.abs(sy - e.clientY) }); }};
    const onUp = (e: MouseEvent) => {
      setIsSelecting(false);
      if (selectionStart.current) {
        const sx = selectionStart.current.x, sy = selectionStart.current.y;
        if (Math.abs(sx - e.clientX) > 5 || Math.abs(sy - e.clientY) > 5) {
            const l = Math.min(sx, e.clientX), t = Math.min(sy, e.clientY), r = Math.max(sx, e.clientX), b = Math.max(sy, e.clientY);
            const newSet = new Set(e.ctrlKey ? selectedFrameIds : []);
            document.querySelectorAll('.sortable-frame').forEach(el => { const rect = el.getBoundingClientRect(); if (!(rect.right < l || rect.left > r || rect.bottom < t || rect.top > b)) { const id = el.getAttribute('data-id'); if (id) newSet.add(id); }});
            setSelectedFrameIds(newSet);
        } else if (!e.ctrlKey) setSelectedFrameIds(new Set());
      }
      setSelectionBox(null); selectionStart.current = null;
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isSelecting, selectedFrameIds]);
  useEffect(() => { let interval: number; if (isPlaying && frames.length > 0) interval = window.setInterval(() => setCurrentPreviewIndex(p => (p + 1) % frames.length), 1000 / fps); return () => clearInterval(interval); }, [isPlaying, frames.length, fps]);

  const getRenderStyle = (rect: Rect) => (!image || !containerRef.current) ? {} : { left: `${(rect.x / image.width) * 100}%`, top: `${(rect.y / image.height) * 100}%`, width: `${(rect.width / image.width) * 100}%`, height: `${(rect.height / image.height) * 100}%` };

  return (
    <LayoutGroup>
      <div className="flex h-screen w-screen flex-col md:flex-row select-none font-sans overflow-hidden bg-zinc-50 dark:bg-slate-950 text-zinc-900 dark:text-zinc-50 relative">
        
        {/* GLOBAL RIPPLE OVERLAY */}
        <AnimatePresence>
            {ripple && (
                <motion.div 
                    initial={{ clipPath: `circle(0px at ${ripple.x}px ${ripple.y}px)` }}
                    animate={{ clipPath: `circle(250% at ${ripple.x}px ${ripple.y}px)` }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.7, ease: "easeInOut" }}
                    className="fixed inset-0 z-[100] pointer-events-none"
                    style={{ 
                        // Simulate color inversion or just a solid sweep based on target theme
                        backgroundColor: theme === 'dark' ? '#f4f4f5' : '#09090b',
                        mixBlendMode: 'difference' 
                    }}
                />
            )}
        </AnimatePresence>

        {/* Context Menu (Same) */}
        {contextMenu && (
             <div className="fixed z-[100] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xl rounded-lg py-1 min-w-[160px] animate-modal" style={{ top: contextMenu.y, left: contextMenu.x }}>
                <div className="px-3 py-1.5 text-xs text-zinc-500 font-bold border-b border-zinc-100 dark:border-zinc-700/50 bg-zinc-50 dark:bg-zinc-800/50 flex justify-between items-center">
                    <span>Action</span>
                    <button onClick={() => setContextMenu(null)}><X size={12}/></button>
                </div>
                <button onClick={(e) => { e.stopPropagation(); if(contextMenu) { const ids = contextMenu.selectionSnapshot; setContextMenu(null); commitFrames(frames.filter(f => !ids.has(f.id))); setSelectedFrameIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; }); } }} 
                    className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2">
                    <Trash2 size={16}/><span>{t('tools_delete', lang)}</span>
                </button>
            </div>
        )}
        
        {/* Context Menu Overlay */}
        {contextMenu && <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => {e.preventDefault(); setContextMenu(null);}}/>}

        {/* LEFT: Editor Area */}
        <div className="flex-1 flex flex-col h-[60vh] md:h-full relative border-r border-zinc-200 dark:border-zinc-800 min-w-0 bg-zinc-50 dark:bg-slate-950">
          
          {/* Toolbar */}
          <div className="h-14 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center px-4 justify-between gap-4 z-20 shadow-sm flex-shrink-0">
             {/* ... Toolbar content same as before ... */}
             <div className="flex items-center gap-2 flex-shrink-0">
                 <div className="font-bold text-lg text-blue-600 dark:text-blue-500 mr-2 flex items-center gap-2 tracking-tight">
                    <Scissors size={20}/> <span className="hidden sm:inline">{t('app_title', lang)}</span>
                 </div>
                 <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 mr-2">
                     <button onClick={undo} disabled={historyIndex <= 0} className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white disabled:opacity-30 rounded transition-smooth hover:bg-white dark:hover:bg-zinc-700 btn-hover-lift"><Undo2 size={16} /></button>
                     <button onClick={redo} disabled={historyIndex >= history.length - 1} className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white disabled:opacity-30 rounded transition-smooth hover:bg-white dark:hover:bg-zinc-700 btn-hover-lift"><Redo2 size={16} /></button>
                 </div>
                 <input type="file" id="file-upload" className="hidden" accept="image/*" onChange={handleFileChange} />
                 <button onClick={handleUploadClick} className="text-xs sm:text-sm flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-md border border-zinc-200 dark:border-zinc-700 transition-smooth btn-hover-lift whitespace-nowrap">
                    <Upload size={14}/> <span>{image ? t('change_btn', lang) : t('upload_btn', lang)}</span>
                 </button>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                {image && (
                   <>
                     <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 mr-2">
                      <button onClick={() => setToolMode('select')} className={`p-1.5 rounded-md transition-smooth btn-hover-lift ${toolMode === 'select' ? 'bg-white dark:bg-zinc-600 text-blue-600 dark:text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'}`}><MousePointer2 size={16}/></button>
                      <button onClick={() => setToolMode('draw')} className={`p-1.5 rounded-md transition-smooth btn-hover-lift ${toolMode === 'draw' ? 'bg-white dark:bg-zinc-600 text-blue-600 dark:text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'}`}><Crop size={16}/></button>
                     </div>
                     <div className="flex items-center gap-2">
                       <button onClick={() => setShowProcessorModal(true)} className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 rounded-md transition-smooth btn-hover-lift whitespace-nowrap text-sm"><Eraser size={14} className="text-pink-500"/><span className="hidden sm:inline">{t('tools_eraser', lang)}</span></button>
                       <div ref={detectBtnRef} className="flex items-center bg-indigo-600 rounded-md shadow-lg shadow-indigo-900/20 transition-transform btn-hover-lift overflow-hidden">
                           <button onClick={handleAutoDetect} disabled={isProcessing} className="flex items-center gap-2 px-3 py-1.5 text-white hover:bg-white/10 disabled:opacity-50 transition-colors text-sm font-medium rounded-l-md">{isProcessing ? <RotateCw className="animate-spin" size={14}/> : <Wand2 size={14}/>}<span className="hidden sm:inline">{t('tools_wand', lang)}</span></button>
                           <div className="w-px h-4 bg-white/20"></div>
                           <button onClick={() => setShowDetectSettings(!showDetectSettings)} className={`px-1.5 py-1.5 text-white hover:bg-white/10 ${showDetectSettings ? 'bg-white/20' : ''}`}><Settings size={14} /></button>
                       </div>
                       <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-800 mx-1"></div>
                       <button onClick={() => setShowRotateModal(true)} disabled={isProcessing || selectedFrameIds.size === 0} className="p-2 text-zinc-400 hover:text-purple-500 transition-smooth btn-hover-lift disabled:opacity-30"><RefreshCw size={18}/></button>
                       <button onClick={() => setShowExportModal(true)} disabled={isProcessing || frames.length === 0} className="p-2 text-zinc-400 hover:text-emerald-500 transition-smooth btn-hover-lift disabled:opacity-30"><Archive size={18}/></button>
                       <button onClick={selectedFrameIds.size > 0 ? handleDeleteSelected : () => window.confirm(t('confirm_clear', lang)) && commitFrames([])} className={`p-2 transition-smooth btn-hover-lift ${selectedFrameIds.size > 0 ? 'text-red-500 hover:text-red-600 animate-pop-in' : 'text-zinc-400 hover:text-red-500'}`}><Trash2 size={18}/></button>
                     </div>
                   </>
                )}
                <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 mx-2"></div>
                <div className="flex items-center gap-1">
                    <button onClick={(e) => triggerRipple(e, () => setLang(l => l === 'en' ? 'zh' : 'en'))} className="p-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-all btn-hover-lift"><Languages size={16} /> {lang.toUpperCase()}</button>
                    <button onClick={(e) => triggerRipple(e, () => setTheme(t => t === 'dark' ? 'light' : 'dark'))} className="p-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-all btn-hover-lift rounded-full">{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button>
                </div>
              </div>
          </div>

          {/* Canvas Area */}
          <div className="flex-1 overflow-auto relative flex items-center justify-center p-8 checkerboard bg-zinc-50 dark:bg-zinc-950 transition-colors duration-500">
            {!image ? (
              <div className="text-center text-zinc-500 flex flex-col items-center gap-4 animate-enter-up">
                <div className="w-24 h-24 bg-white dark:bg-zinc-900 rounded-2xl flex items-center justify-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 transition-colors hover:border-zinc-400 dark:hover:border-zinc-700 shadow-sm">
                  <ImageIcon size={48} strokeWidth={1} />
                </div>
                <div>
                    <p className="text-zinc-600 dark:text-zinc-400 font-medium">{t('empty_title', lang)}</p>
                    <p className="text-xs mt-1 text-zinc-400 dark:text-zinc-500">{t('empty_desc', lang)}</p>
                </div>
              </div>
            ) : (
              <div 
                ref={containerRef}
                className={`relative shadow-2xl inline-block ring-1 ring-black/5 dark:ring-white/10 ${toolMode === 'draw' ? 'cursor-crosshair' : 'cursor-default'}`}
                onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
                style={{ width: 'fit-content', height: 'fit-content' }}
              >
                {/* Main Image with Entry Animation */}
                <motion.img 
                    key={image.url} 
                    src={image.url} 
                    alt="Source" 
                    className="block"
                    draggable={false}
                    style={isFitToScreen ? { maxWidth: '100%', maxHeight: 'calc(100vh - 160px)', objectFit: 'contain' } : { maxWidth: 'none' }}
                    initial={uploadOrigin ? { 
                        clipPath: `circle(0% at ${uploadOrigin.x}px ${uploadOrigin.y}px)`,
                        filter: "blur(20px)"
                    } : { opacity: 0 }}
                    animate={{ 
                        clipPath: `circle(150% at 50% 50%)`,
                        filter: "blur(0px)",
                        opacity: 1 
                    }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                />
                
                {/* SCANNING CURTAIN */}
                <AnimatePresence>
                    {isScanning && (
                        <motion.div 
                            className="absolute inset-0 z-50 pointer-events-none overflow-hidden"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        >
                            <motion.div 
                                className="w-full h-8 bg-gradient-to-b from-transparent via-indigo-500/50 to-transparent shadow-[0_0_20px_rgba(99,102,241,0.5)]"
                                initial={{ top: '-10%' }}
                                animate={{ top: '110%' }}
                                transition={{ duration: 1.5, ease: "linear", repeat: Infinity }}
                            />
                             <motion.div 
                                className="w-full h-0.5 bg-indigo-400 shadow-[0_0_10px_rgba(99,102,241,1)] absolute"
                                initial={{ top: '-10%' }}
                                animate={{ top: '110%' }}
                                transition={{ duration: 1.5, ease: "linear", repeat: Infinity }}
                            />
                            <div className="absolute inset-0 bg-indigo-500/5 mix-blend-overlay" />
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Overlay Rects on Canvas */}
                {/* Render Existing Frames Overlay */}
                {frames.map((frame, idx) => (
                    <motion.div 
                        key={frame.id} 
                        style={getRenderStyle(frame)} 
                        onClick={(e) => toolMode === 'select' && handleFrameClick(frame.id, e)}
                        className={`absolute border transition-all duration-200 group ${selectedFrameIds.has(frame.id) ? 'border-blue-500 bg-blue-500/20 z-10' : 'border-emerald-500/50 hover:border-emerald-400 hover:bg-emerald-500/10'}`}
                        // Rotate Animation
                        animate={isRotating && selectedFrameIds.has(frame.id) ? { rotate: 360 } : { rotate: 0 }}
                        transition={{ duration: 0.8, ease: "backInOut" }}
                    >
                         {/* Warp Animation to Preview */}
                        {previewWarp === frame.id && (
                             <motion.div 
                                className="absolute inset-0 bg-white/50"
                                initial={{ opacity: 1, scale: 1, rotate: 0 }}
                                animate={{ opacity: 0, scale: 0, rotate: 180, x: 200, y: -200 }} // Arbitrary "towards preview" direction
                                transition={{ duration: 0.5 }}
                             />
                        )}
                        <div className="absolute -top-5 left-0 bg-blue-600 text-white text-[9px] px-1 rounded-sm opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-20 font-mono">#{idx + 1}</div>
                    </motion.div>
                ))}

                {/* GHOST FRAMES (Flying Logic) */}
                {/* These appear on canvas first, then "Fly" because layoutId matches timeline items */}
                {ghostFrames.map((frame) => (
                    <motion.div
                        layoutId={frame.id}
                        key={frame.id}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1, borderColor: '#a855f7', boxShadow: "0 0 20px rgba(168,85,247,0.5)" }}
                        exit={{ opacity: 0, transition: { duration: 0.1 } }} 
                        style={getRenderStyle(frame)}
                        className="absolute border-2 border-purple-500 z-50 pointer-events-none"
                        transition={{ 
                            type: "spring",
                            stiffness: 300,
                            damping: 30
                        }}
                    />
                ))}

                {tempRect && <div style={getRenderStyle(tempRect)} className="absolute border border-dashed border-white bg-white/10 pointer-events-none shadow-[0_0_0_1px_black]" />}
              </div>
            )}
            
            {image && (
                <div className="absolute bottom-4 right-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-1 flex gap-1 shadow-xl">
                     <button onClick={() => setIsFitToScreen(true)} className={`p-1.5 rounded transition-smooth ${isFitToScreen ? 'bg-zinc-100 dark:bg-zinc-700 text-black dark:text-white' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}><Minimize size={14} /></button>
                     <button onClick={() => setIsFitToScreen(false)} className={`p-1.5 rounded transition-smooth ${!isFitToScreen ? 'bg-zinc-100 dark:bg-zinc-700 text-black dark:text-white' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}><Maximize size={14} /></button>
                </div>
            )}
          </div>
        </div>

        {/* RIGHT SIDEBAR */}
        <div className="h-[40vh] md:h-full md:w-80 bg-white dark:bg-zinc-900 border-t md:border-t-0 md:border-l border-zinc-200 dark:border-zinc-800 flex flex-col z-30 shadow-2xl flex-shrink-0">
          
          {/* Preview Panel */}
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
            <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t('preview_title', lang)}</h3>
                <div className="text-[10px] text-zinc-400 font-mono">{frames.length > 0 ? `${currentPreviewIndex + 1} / ${frames.length}` : '0 / 0'}</div>
            </div>
            
            <div className="aspect-square w-full bg-zinc-100 dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 flex items-center justify-center mb-4 relative checkerboard overflow-hidden shadow-inner group">
               {frames.length > 0 ? (
                 <motion.img 
                    key={currentPreviewIndex}
                    initial={isPlaying ? { opacity: 1 } : { opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    src={frames[currentPreviewIndex]?.imageData} 
                    className="max-w-full max-h-full object-contain" 
                    style={{ imageRendering: 'pixelated' }} 
                 />
               ) : <span className="text-zinc-400 text-xs">{t('empty_list', lang)}</span>}
               {/* Preview Warp Target */}
               <div className={`absolute inset-0 bg-blue-500/20 pointer-events-none transition-opacity duration-300 ${previewWarp ? 'opacity-100' : 'opacity-0'}`} />
            </div>

            <div className="flex items-center gap-3">
               <button onClick={handlePlayClick} className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded font-medium text-sm transition-smooth btn-hover-lift ${isPlaying ? 'bg-amber-500/10 text-amber-600 dark:text-amber-500 hover:bg-amber-500/20' : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white border border-zinc-200 dark:border-zinc-700'}`}>
                 {isPlaying ? <Pause size={14} fill="currentColor"/> : <Play size={14} fill="currentColor"/>} {isPlaying ? t('pause', lang) : t('play', lang)}
               </button>
               <div className="flex items-center gap-2 bg-white dark:bg-zinc-950 rounded px-2 py-1.5 border border-zinc-200 dark:border-zinc-800 w-24">
                  <span className="text-[10px] text-zinc-400">{t('fps', lang)}</span>
                  <input type="number" min="1" max="60" value={fps} onChange={(e) => setFps(Number(e.target.value))} className="w-full bg-transparent text-right text-xs text-zinc-700 dark:text-zinc-300 outline-none"/>
               </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="flex-1 flex flex-col min-h-0 relative bg-zinc-50 dark:bg-zinc-900 transition-colors duration-500">
            <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center bg-white/90 dark:bg-zinc-900/90 backdrop-blur sticky top-0 z-10">
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t('frames_title', lang)} ({frames.length})</h3>
              <Settings2 size={12} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"/>
            </div>
            <div className="flex-1 overflow-y-auto p-3 relative" ref={timelineRef} onMouseDown={handleTimelineMouseDown}>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={frames.map(f => f.id)} strategy={horizontalListSortingStrategy}>
                  <div className="flex flex-wrap gap-2 content-start pb-20">
                    <AnimatePresence>
                        {frames.map((frame, index) => (
                        <SortableFrame key={frame.id} frame={frame} index={index} isSelected={selectedFrameIds.has(frame.id)} onSelect={handleFrameClick} onDelete={handleDeleteSingle} onContextMenu={(id, e) => {e.preventDefault(); e.stopPropagation(); const newSel = new Set(selectedFrameIds); if(!newSel.has(id)) { newSel.clear(); newSel.add(id); setSelectedFrameIds(newSel); setLastSelectedId(id); } setContextMenu({x:e.clientX, y:e.clientY, targetId:id, selectionSnapshot: newSel});}} />
                        ))}
                    </AnimatePresence>
                    {frames.length === 0 && <div className="w-full py-12 text-center text-zinc-400 text-xs italic select-none pointer-events-none animate-enter-up delay-100">{t('empty_list', lang)}<br/>{t('empty_list_sub', lang)}</div>}
                  </div>
                </SortableContext>
              </DndContext>
              {selectionBox && <div className="fixed border border-blue-500 bg-blue-500/10 z-50 pointer-events-none" style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.w, height: selectionBox.h }} />}
            </div>
          </div>
        </div>

        {/* --- POPUPS / MODALS --- */}
        {/* Detection Settings */}
        <AnimatePresence>
            {showDetectSettings && detectBtnRef.current && (
                <>
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40" onClick={() => setShowDetectSettings(false)} />
                    <motion.div initial={{ opacity: 0, scale: 0.9, x: -20 }} animate={{ opacity: 1, scale: 1, x: 0 }} exit={{ opacity: 0, scale: 0.9 }} className="fixed z-50 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl p-3 w-56 origin-top-right text-zinc-900 dark:text-zinc-100" style={{ top: detectBtnRef.current.getBoundingClientRect().bottom + 6, left: detectBtnRef.current.getBoundingClientRect().right, transform: 'translateX(-100%)' }}>
                        {/* Settings Content Same as before */}
                        <div className="flex justify-between items-center mb-2"><span className="text-xs font-bold text-zinc-500 uppercase">{t('detect_settings', lang)}</span><button onClick={() => setShowDetectSettings(false)}><X size={12} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"/></button></div>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between cursor-pointer group" onClick={() => setDetectIgnoreNested(!detectIgnoreNested)}><span className="text-sm">{t('merge_nested', lang)}</span><div className={`w-8 h-4 rounded-full p-0.5 transition-all duration-300 ${detectIgnoreNested ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-600'}`}><div className={`w-3 h-3 bg-white rounded-full shadow transition-all duration-300 ${detectIgnoreNested ? 'translate-x-4' : 'translate-x-0'}`} /></div></div>
                            <div><div className="flex justify-between text-xs text-zinc-500 mb-1"><span>{t('min_area', lang)}</span><span>{detectMinArea}px</span></div><input type="range" min="16" max="500" step="16" value={detectMinArea} onChange={(e) => setDetectMinArea(Number(e.target.value))} className="w-full h-1 bg-zinc-200 dark:bg-zinc-600 rounded-lg appearance-none cursor-pointer accent-indigo-500"/></div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>

        {/* Image Processor */}
        <AnimatePresence>
            {showProcessorModal && image && <ImageProcessorModal key="processor" imageSrc={image.url} onClose={() => setShowProcessorModal(false)} onConfirm={handleImageUpdate} lang={lang} />}
        </AnimatePresence>

        {/* Rotate Modal */}
        {showRotateModal && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden flex flex-col text-zinc-900 dark:text-zinc-100">
                {/* Rotate Modal Content (Condensed) */}
                <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900"><h3 className="text-lg font-bold flex items-center gap-2"><RefreshCw size={20} className="text-purple-500"/>{t('modal_rotate_title', lang)}</h3></div>
                <div className="p-6 space-y-6 bg-white dark:bg-zinc-900/50">
                    <div><label className="flex justify-between text-zinc-500 text-xs mb-2 font-bold uppercase"><span>{t('frames_count', lang)}</span><span className="text-purple-500 font-mono">{rotateFrameCount}</span></label><input type="range" min="4" max="36" step="1" value={rotateFrameCount} onChange={(e) => setRotateFrameCount(Number(e.target.value))} className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500"/></div>
                    <div className="h-px bg-zinc-200 dark:bg-zinc-800"></div>
                    <div className="space-y-3">
                        <div className={`group flex flex-col p-3 rounded-lg border cursor-pointer transition-all ${rotateUseBlur ? 'bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/50' : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'}`}>
                            <div className="flex items-center justify-between w-full" onClick={() => setRotateUseBlur(!rotateUseBlur)}><div className="flex items-center gap-3"><div className={`p-2 rounded ${rotateUseBlur ? 'bg-purple-500 text-white' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'}`}><Wind size={16} /></div><div className="flex flex-col"><span className={`text-sm font-medium ${rotateUseBlur ? 'text-purple-600 dark:text-purple-300' : 'text-zinc-700 dark:text-zinc-300'}`}>{t('motion_blur', lang)}</span><span className="text-[10px] text-zinc-500">{t('motion_blur_desc', lang)}</span></div></div><div className={`w-4 h-4 rounded-full border ${rotateUseBlur ? 'bg-purple-500 border-purple-500' : 'border-zinc-300 dark:border-zinc-600'}`}></div></div>
                            {rotateUseBlur && (<div className="mt-4 space-y-3 pl-2 pr-1 animate-enter-up"><div><div className="flex justify-between text-[10px] text-zinc-500 mb-1"><span className="flex items-center gap-1"><Aperture size={10}/> {t('blur_angle', lang)}</span><span>{rotateBlurAngle}°</span></div><input type="range" min="5" max="45" value={rotateBlurAngle} onChange={(e) => setRotateBlurAngle(Number(e.target.value))} className="w-full h-1 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-400"/></div></div>)}
                        </div>
                        <div className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${rotateReplace ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/50' : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'}`} onClick={() => setRotateReplace(!rotateReplace)}><div className="flex items-center gap-3"><div className={`p-2 rounded ${rotateReplace ? 'bg-blue-500 text-white' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'}`}><Replace size={16} /></div><div className="flex flex-col"><span className={`text-sm font-medium ${rotateReplace ? 'text-blue-600 dark:text-blue-300' : 'text-zinc-700 dark:text-zinc-300'}`}>{t('replace_origin', lang)}</span><span className="text-[10px] text-zinc-500">{t('replace_origin_desc', lang)}</span></div></div><div className={`w-4 h-4 rounded-full border ${rotateReplace ? 'bg-blue-500 border-blue-500' : 'border-zinc-300 dark:border-zinc-600'}`}></div></div>
                    </div>
                </div>
                <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex gap-3">
                <button onClick={() => setShowRotateModal(false)} className="flex-1 py-2.5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg text-sm font-medium transition-colors btn-hover-lift">{t('btn_cancel', lang)}</button>
                <button onClick={handleGenerateRotation} className="flex-[2] py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold shadow-lg shadow-purple-900/20 text-sm flex items-center justify-center gap-2 transition-transform active:scale-95 btn-hover-lift"><RefreshCw size={16}/> {t('btn_start_gen', lang)}</button>
                </div>
            </motion.div>
            </motion.div>
        )}

        {/* Export Modal */}
        {showExportModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-pop-in">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-xl shadow-2xl max-w-sm w-full mx-4 text-zinc-900 dark:text-zinc-100">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Archive size={20} className="text-blue-500"/>{t('export_title', lang)}</h3>
                <p className="text-zinc-500 mb-6 text-sm">{t('export_desc', lang, {n: frames.length})}</p>
                <div className="flex flex-col gap-3">
                {frames.length === 1 && <button onClick={() => performExport('png')} className="w-full py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-lg font-medium transition-colors btn-hover-lift">{t('export_png', lang)}</button>}
                <button onClick={() => performExport('zip')} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors btn-hover-lift">{t('export_zip', lang)}</button>
                <button onClick={() => setShowExportModal(false)} className="mt-2 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 text-sm py-2 transition-colors">{t('btn_cancel', lang)}</button>
                </div>
            </div>
            </div>
        )}
      </div>
    </LayoutGroup>
  );
}