import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, Wand2, Play, Pause, Scissors, Trash2, MousePointer2, Crop, RotateCw, Image as ImageIcon,
  Maximize, Minimize, Archive, X, RefreshCw, Eraser, Settings2, Wind, Replace,
  Aperture, Undo2, Redo2, Settings, Sun, Moon, Languages, Merge
} from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import JSZip from 'jszip';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

import { detectSprites, cropFrame } from './utils/spriteDetector';
import { SortableFrame } from './components/SortableFrame';
import { ImageProcessorModal } from './components/ImageProcessorModal';
import { Frame, ImageState, Rect, ToolMode } from './types';
import { v4 as uuidv4 } from 'uuid';
import { t, Lang } from './utils/i18n';

gsap.registerPlugin(useGSAP);

type Theme = 'light' | 'dark';

export default function App() {
  // Config State
  const [lang, setLang] = useState<Lang>('zh');
  const [theme, setTheme] = useState<Theme>('dark');
  
  // App State
  const [image, setImage] = useState<ImageState | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  
  // History State
  const [history, setHistory] = useState<Frame[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Selection State
  const [selectedFrameIds, setSelectedFrameIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  
  // Special Animation States
  const [isScanning, setIsScanning] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [previewWarp, setPreviewWarp] = useState<string | null>(null);
  
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

  // Refs for GSAP
  const appRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const themeIconRef = useRef<HTMLDivElement>(null);
  const langTextRef = useRef<HTMLSpanElement>(null);
  const scannerRef = useRef<HTMLDivElement>(null);
  
  // Tracking animated frames to prevent re-animation
  const animatedFrameIds = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [theme]);

  // --- GSAP Global Animations ---
  
  // Scanner Animation
  useGSAP(() => {
    if (isScanning && scannerRef.current) {
        gsap.fromTo(scannerRef.current, 
            { top: '-10%', opacity: 1 },
            { 
                top: '110%', 
                duration: 1.5, 
                repeat: -1, 
                ease: 'linear',
                opacity: 1
            }
        );
    }
  }, [isScanning]);

  // Canvas Frame Entrance Animation (Purple -> Green)
  useGSAP(() => {
    if (frames.length > 0 && !isScanning && !isRotating) {
        // Target only NEW frames
        const newElements = gsap.utils.toArray(".canvas-frame.animate-new");
        
        if (newElements.length > 0) {
            gsap.fromTo(newElements, 
                { 
                    borderColor: "#a855f7", // Start Purple (Detection)
                    backgroundColor: "rgba(168, 85, 247, 0.25)",
                    boxShadow: "0 0 20px rgba(168, 85, 247, 0.6)",
                    scale: 1.1,
                    opacity: 0
                },
                { 
                    borderColor: "rgba(16, 185, 129, 0.5)", // End Green (Persistence)
                    backgroundColor: "transparent",
                    boxShadow: "none",
                    scale: 1, 
                    opacity: 1, 
                    duration: 0.8, 
                    stagger: {
                        amount: 0.5,
                        grid: "auto",
                        from: "start"
                    },
                    ease: "elastic.out(1, 0.75)",
                    // CRITICAL FIX: Only clear animation-related props. 
                    // DO NOT clear 'all' or it removes 'left/top/width/height' positioning!
                    clearProps: "borderColor,backgroundColor,boxShadow,scale,opacity,transform"
                }
            );

            // Mark these IDs as animated so they don't animate again on re-renders
            newElements.forEach((el: any) => {
                const id = el.getAttribute('data-id');
                if (id) animatedFrameIds.current.add(id);
            });
        }
    }
  }, [frames]); // Re-run when frames list changes

  // General Button Hover Effect
  const setupButtonHover = (e: React.MouseEvent<HTMLElement>) => {
      if ((e.currentTarget as HTMLButtonElement).disabled) return;
      gsap.to(e.currentTarget, {
          scale: 1.05,
          y: -2,
          duration: 0.3,
          ease: "elastic.out(1, 0.5)",
          overwrite: true
      });
  };

  const resetButtonHover = (e: React.MouseEvent<HTMLElement>) => {
      gsap.to(e.currentTarget, {
          scale: 1,
          y: 0,
          rotation: 0,
          duration: 0.2,
          ease: "power2.out",
          overwrite: true
      });
  };

  // --- Logic ---

  const commitFrames = useCallback((newFrames: Frame[], reset: boolean = false) => {
      setFrames(newFrames);
      if (reset) {
          setHistory([newFrames]); setHistoryIndex(0);
          animatedFrameIds.current.clear(); // Clear animation cache on reset
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage({ url, width: img.width, height: img.height, file });
      commitFrames([], true);
      setSelectedFrameIds(new Set());
      setIsFitToScreen(true);
      
      // Image Entry Animation
      setTimeout(() => {
        gsap.fromTo(".main-image", 
            { opacity: 0, scale: 0.9, filter: "blur(20px)" },
            { opacity: 1, scale: 1, filter: "blur(0px)", duration: 1, ease: "power2.out" }
        );
      }, 50);
    };
    img.src = url;
    e.target.value = '';
  };

  const handleUploadClick = () => document.getElementById('file-upload')?.click();

  const handleImageUpdate = (newImageSrc: string) => {
      const img = new Image();
      img.onload = () => {
          setImage(prev => prev ? { ...prev, url: newImageSrc, width: img.width, height: img.height } : null);
          commitFrames([], true);
          setSelectedFrameIds(new Set());
          setShowProcessorModal(false);
      };
      img.onerror = () => {
          console.error("Failed to load processed image");
          setShowProcessorModal(false);
      };
      img.src = newImageSrc;
  };

  const handleAutoDetect = async () => {
    if (!image) return;
    setIsScanning(true);
    setShowDetectSettings(false);
    
    // Wait for scan visual
    await new Promise(r => setTimeout(r, 1200));
    
    try {
      const rects = await detectSprites(image.url, 10, detectIgnoreNested, detectMinArea);
      const uniqueRects = rects.filter(newRect => {
        return !frames.some(existingFrame => {
           const xDiff = Math.abs(newRect.x - existingFrame.x);
           const yDiff = Math.abs(newRect.y - existingFrame.y);
           const wDiff = Math.abs(newRect.width - existingFrame.width);
           const hDiff = Math.abs(newRect.height - existingFrame.height);
           return xDiff < 4 && yDiff < 4 && wDiff < 4 && hDiff < 4;
        });
      });

      if (uniqueRects.length === 0) {
        setIsScanning(false);
        return;
      }

      const detectedFrames = await Promise.all(uniqueRects.map(async (rect, i) => ({
          ...rect, id: uuidv4(), order: frames.length + i, imageData: await cropFrame(image.url, rect)
      })));

      setIsScanning(false);
      // Immediately commit frames to trigger the Pop-in animation
      commitFrames([...frames, ...detectedFrames]);

    } catch (err) {
      console.error(err);
      setIsScanning(false);
    }
  };

  const handleSwitchTheme = () => {
    if (!themeIconRef.current) return;
    const tl = gsap.timeline();
    tl.to(themeIconRef.current, { rotationY: 90, scale: 0.5, opacity: 0, duration: 0.2, ease: "back.in(2)" });
    tl.add(() => setTheme(t => t === 'dark' ? 'light' : 'dark'));
    tl.fromTo(themeIconRef.current, { rotationY: -90, scale: 0.5, opacity: 0 }, { rotationY: 0, scale: 1, opacity: 1, duration: 0.5, ease: "elastic.out(1, 0.4)" });
  };

  const handleSwitchLang = () => {
      if (!langTextRef.current) return;
      const tl = gsap.timeline();
      tl.to(langTextRef.current, { y: -20, opacity: 0, filter: "blur(4px)", duration: 0.2, ease: "power2.in" });
      tl.add(() => setLang(l => l === 'en' ? 'zh' : 'en'));
      tl.fromTo(langTextRef.current, { y: 20, opacity: 0, filter: "blur(4px)" }, { y: 0, opacity: 1, filter: "blur(0px)", duration: 0.3, ease: "power2.out" });
  };

  const handleMergeSelected = async () => {
    if (selectedFrameIds.size < 2 || !image) return;
    const selectedFrames = frames.filter(f => selectedFrameIds.has(f.id));
    if (selectedFrames.length < 2) return;
    
    // Calculate Union Rect
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selectedFrames.forEach(f => {
      minX = Math.min(minX, f.x);
      minY = Math.min(minY, f.y);
      maxX = Math.max(maxX, f.x + f.width);
      maxY = Math.max(maxY, f.y + f.height);
    });
    
    const unionRect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    const newImageData = await cropFrame(image.url, unionRect);
    
    const newFrame: Frame = {
      id: uuidv4(),
      order: selectedFrames[0].order,
      ...unionRect,
      imageData: newImageData
    };
    
    // Calculate where to insert (at the position of the first selected item)
    // We sort selected frames by their current index to find the "first" appearance
    const sortedIndices = selectedFrames.map(f => frames.findIndex(curr => curr.id === f.id)).sort((a,b) => a - b);
    const insertIndex = sortedIndices[0];
    
    // Create new list: Remove selected, insert new one
    const remainingFrames = frames.filter(f => !selectedFrameIds.has(f.id));
    remainingFrames.splice(insertIndex, 0, newFrame);
    
    setContextMenu(null);
    commitFrames(remainingFrames);
    setSelectedFrameIds(new Set([newFrame.id]));
  };

  const handleGenerateRotation = async () => {
      let sourceFrame = frames.find(f => f.id === lastSelectedId) || frames.find(f => f.id === Array.from(selectedFrameIds)[0]);
      if (!sourceFrame?.imageData) return;
      setShowRotateModal(false);
      setIsRotating(true);
      await new Promise(r => setTimeout(r, 800)); 
      
      const flash = document.createElement('div');
      flash.className = "fixed inset-0 bg-white z-[100] pointer-events-none";
      document.body.appendChild(flash);
      gsap.to(flash, { opacity: 0, duration: 0.5, onComplete: () => flash.remove() });

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
        
        let updated = [...frames];
        if (rotateReplace && sourceFrame) updated.splice(updated.findIndex(f => f.id === sourceFrame!.id), 1, ...newFrames);
        else updated.push(...newFrames);
        commitFrames(updated);
        setIsRotating(false);
      } catch(e) { console.error(e); setIsRotating(false); }
  };

  const performExport = async (format: 'png' | 'zip') => { 
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
      
      // Mark manual frames as 'already animated' to skip purple entrance animation
      // This satisfies the user request to keep the green box stable immediately
      animatedFrameIds.current.add(newFrame.id);
      
      commitFrames([...frames, newFrame]); 
      setSelectedFrameIds(new Set([newFrame.id])); 
      setToolMode('select');
    }
    setTempRect(null);
  };
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setFrames((items) => arrayMove(items, items.findIndex(f => f.id === active.id), items.findIndex(f => f.id === over.id)));
    }
  };

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
  
  const handlePlayClick = () => {
    if (isPlaying) { setIsPlaying(false); return; }
    if (selectedFrameIds.size > 0) {
        const firstId = Array.from(selectedFrameIds)[0];
        setPreviewWarp(firstId);
        setTimeout(() => { setPreviewWarp(null); setIsPlaying(true); }, 600);
    } else { setIsPlaying(true); }
  };
  useEffect(() => { let interval: number; if (isPlaying && frames.length > 0) interval = window.setInterval(() => setCurrentPreviewIndex(p => (p + 1) % frames.length), 1000 / fps); return () => clearInterval(interval); }, [isPlaying, frames.length, fps]);

  const handleDeleteSelected = () => { commitFrames(frames.filter(f => !selectedFrameIds.has(f.id))); setSelectedFrameIds(new Set()); };
  const handleDeleteSingle = (id: string) => { commitFrames(frames.filter(f => f.id !== id)); if(selectedFrameIds.has(id)) { const s = new Set(selectedFrameIds); s.delete(id); setSelectedFrameIds(s); }};

  const getRenderStyle = (rect: Rect) => (!image || !containerRef.current) ? {} : { left: `${(rect.x / image.width) * 100}%`, top: `${(rect.y / image.height) * 100}%`, width: `${(rect.width / image.width) * 100}%`, height: `${(rect.height / image.height) * 100}%` };

  return (
    <div ref={appRef} className="flex h-screen w-full flex-col md:flex-row select-none font-sans overflow-hidden bg-zinc-50 dark:bg-slate-950 text-zinc-900 dark:text-zinc-50 relative">
        
        {/* Context Menu */}
        {contextMenu && (
             <div className="fixed z-[100] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-xl rounded-lg py-1 min-w-[160px]" style={{ top: contextMenu.y, left: contextMenu.x }}>
                <div className="px-3 py-1.5 text-xs text-zinc-500 font-bold border-b border-zinc-100 dark:border-zinc-700/50 bg-zinc-50 dark:bg-zinc-800/50 flex justify-between items-center">
                    <span>Action</span>
                    <button onClick={() => setContextMenu(null)}><X size={12}/></button>
                </div>
                {contextMenu.selectionSnapshot.size > 1 && (
                    <button onClick={(e) => { e.stopPropagation(); handleMergeSelected(); }} 
                        className="w-full text-left px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-700/50">
                        <Merge size={16}/><span>{t('tools_merge', lang)}</span>
                    </button>
                )}
                <button onClick={(e) => { e.stopPropagation(); if(contextMenu) { const ids = contextMenu.selectionSnapshot; setContextMenu(null); commitFrames(frames.filter(f => !ids.has(f.id))); setSelectedFrameIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; }); } }} 
                    className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2">
                    <Trash2 size={16}/><span>{t('tools_delete', lang)}</span>
                </button>
            </div>
        )}
        {contextMenu && <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => {e.preventDefault(); setContextMenu(null);}}/>}

        {/* LEFT: Editor Area */}
        <div className="flex-1 flex flex-col h-[60vh] md:h-full relative border-r border-zinc-200 dark:border-zinc-800 min-w-0 bg-zinc-50 dark:bg-slate-950">
          
          {/* Toolbar */}
          <div className="h-14 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center px-4 justify-between gap-4 z-20 shadow-sm flex-shrink-0">
             <div className="flex items-center gap-2 flex-shrink-0">
                 <div className="font-bold text-lg text-blue-600 dark:text-blue-500 mr-2 flex items-center gap-2 tracking-tight">
                    <Scissors size={20}/> <span className="hidden sm:inline">{t('app_title', lang)}</span>
                 </div>
                 <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 mr-2">
                     <button onClick={undo} onMouseEnter={setupButtonHover} onMouseLeave={resetButtonHover} disabled={historyIndex <= 0} className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white disabled:opacity-30 rounded hover:bg-white dark:hover:bg-zinc-700"><Undo2 size={16} /></button>
                     <button onClick={redo} onMouseEnter={setupButtonHover} onMouseLeave={resetButtonHover} disabled={historyIndex >= history.length - 1} className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white disabled:opacity-30 rounded hover:bg-white dark:hover:bg-zinc-700"><Redo2 size={16} /></button>
                 </div>
                 <input type="file" id="file-upload" className="hidden" accept="image/*" onChange={handleFileChange} />
                 <button onClick={handleUploadClick} onMouseEnter={setupButtonHover} onMouseLeave={resetButtonHover} className="text-xs sm:text-sm flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-md border border-zinc-200 dark:border-zinc-700 whitespace-nowrap">
                    <Upload size={14}/> <span>{image ? t('change_btn', lang) : t('upload_btn', lang)}</span>
                 </button>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                {image && (
                   <>
                     <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700 mr-2">
                      <button onClick={() => setToolMode('select')} onMouseEnter={setupButtonHover} onMouseLeave={resetButtonHover} className={`p-1.5 rounded-md ${toolMode === 'select' ? 'bg-white dark:bg-zinc-600 text-blue-600 dark:text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'}`}><MousePointer2 size={16}/></button>
                      <button onClick={() => setToolMode('draw')} onMouseEnter={setupButtonHover} onMouseLeave={resetButtonHover} className={`p-1.5 rounded-md ${toolMode === 'draw' ? 'bg-white dark:bg-zinc-600 text-blue-600 dark:text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'}`}><Crop size={16}/></button>
                     </div>
                     <div className="flex items-center gap-2">
                       <button onClick={() => setShowProcessorModal(true)} onMouseEnter={setupButtonHover} onMouseLeave={resetButtonHover} className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 rounded-md whitespace-nowrap text-sm"><Eraser size={14} className="text-pink-500"/><span className="hidden sm:inline">{t('tools_eraser', lang)}</span></button>
                       <div ref={detectBtnRef} className="flex items-center bg-indigo-600 rounded-md shadow-lg shadow-indigo-900/20 overflow-hidden gsap-btn">
                           <button onClick={handleAutoDetect} disabled={isProcessing} className="flex items-center gap-2 px-3 py-1.5 text-white hover:bg-white/10 disabled:opacity-50 transition-colors text-sm font-medium rounded-l-md">{isProcessing ? <RotateCw className="animate-spin" size={14}/> : <Wand2 size={14}/>}<span className="hidden sm:inline">{t('tools_wand', lang)}</span></button>
                           <div className="w-px h-4 bg-white/20"></div>
                           <button onClick={() => setShowDetectSettings(!showDetectSettings)} className={`px-1.5 py-1.5 text-white hover:bg-white/10 ${showDetectSettings ? 'bg-white/20' : ''}`}><Settings size={14} /></button>
                       </div>
                       <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-800 mx-1"></div>
                       {selectedFrameIds.size > 1 && (
                            <button onClick={handleMergeSelected} onMouseEnter={setupButtonHover} onMouseLeave={resetButtonHover} className="p-2 text-zinc-400 hover:text-blue-500" title={t('tools_merge', lang)}><Merge size={18}/></button>
                       )}
                       <button onClick={() => setShowRotateModal(true)} onMouseEnter={setupButtonHover} onMouseLeave={resetButtonHover} disabled={isProcessing || selectedFrameIds.size === 0} className="p-2 text-zinc-400 hover:text-purple-500 disabled:opacity-30"><RefreshCw size={18}/></button>
                       <button onClick={() => setShowExportModal(true)} onMouseEnter={setupButtonHover} onMouseLeave={resetButtonHover} disabled={isProcessing || frames.length === 0} className="p-2 text-zinc-400 hover:text-emerald-500 disabled:opacity-30"><Archive size={18}/></button>
                       <button onClick={selectedFrameIds.size > 0 ? handleDeleteSelected : () => window.confirm(t('confirm_clear', lang)) && commitFrames([])} onMouseEnter={setupButtonHover} onMouseLeave={resetButtonHover} className={`p-2 ${selectedFrameIds.size > 0 ? 'text-red-500 hover:text-red-600' : 'text-zinc-400 hover:text-red-500'}`}><Trash2 size={18}/></button>
                     </div>
                   </>
                )}
                <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-800 mx-2"></div>
                <div className="flex items-center gap-2">
                    {/* Language Switcher */}
                    <button 
                        onClick={handleSwitchLang}
                        className="relative h-9 px-3 flex items-center gap-2 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 font-medium text-xs text-zinc-600 dark:text-zinc-300 min-w-[72px] overflow-hidden"
                    >
                         <Languages size={14} className="shrink-0" />
                         <span ref={langTextRef} className="inline-block">{lang === 'en' ? 'EN' : '中文'}</span>
                    </button>
                    
                    {/* Theme Switcher */}
                    <button 
                        onClick={handleSwitchTheme}
                        className="relative w-9 h-9 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors focus:outline-none"
                        style={{ perspective: '1000px' }}
                    >
                        <div ref={themeIconRef}>
                            {theme === 'dark' ? <Moon size={18} className="text-indigo-400"/> : <Sun size={18} className="text-amber-500"/>}
                        </div>
                    </button>
                </div>
              </div>
          </div>

          {/* Canvas Area */}
          <div className="flex-1 overflow-auto relative flex items-center justify-center p-8 checkerboard bg-zinc-50 dark:bg-zinc-950 transition-colors duration-500">
            {!image ? (
              <div className="text-center text-zinc-500 flex flex-col items-center gap-4">
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
                {/* Main Image */}
                <img 
                    key={image.url} 
                    src={image.url} 
                    alt="Source" 
                    className="block main-image"
                    draggable={false}
                    style={isFitToScreen ? { maxWidth: '100%', maxHeight: 'calc(100vh - 160px)', objectFit: 'contain' } : { maxWidth: 'none' }}
                />
                
                {/* GSAP Powered Scanning Curtain */}
                {isScanning && (
                    <div className="absolute inset-0 z-50 pointer-events-none overflow-hidden">
                        <div 
                            ref={scannerRef}
                            className="absolute w-full h-8 bg-gradient-to-b from-transparent via-indigo-500/50 to-transparent shadow-[0_0_20px_rgba(99,102,241,0.8)]"
                            style={{ top: '-10%' }}
                        />
                        <div className="absolute inset-0 bg-indigo-500/5 mix-blend-overlay" />
                    </div>
                )}

                {/* Frames Overlay */}
                {frames.map((frame, idx) => {
                    const isNew = !animatedFrameIds.current.has(frame.id);
                    return (
                        <div 
                            key={frame.id} 
                            data-id={frame.id}
                            style={getRenderStyle(frame)} 
                            onClick={(e) => toolMode === 'select' && handleFrameClick(frame.id, e)}
                            className={`canvas-frame ${isNew ? 'animate-new' : ''} absolute border transition-colors duration-200 group ${selectedFrameIds.has(frame.id) ? 'border-blue-500 bg-blue-500/20 z-10' : 'border-emerald-500/50 hover:border-emerald-400'}`}
                        >
                            <div className="absolute -top-5 left-0 bg-blue-600 text-white text-[9px] px-1 rounded-sm opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-20 font-mono">#{idx + 1}</div>
                        </div>
                    );
                })}

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

        {/* RIGHT SIDEBAR - RESTORED */}
        <div className="h-[40vh] md:h-full md:w-80 bg-white dark:bg-zinc-900 border-t md:border-t-0 md:border-l border-zinc-200 dark:border-zinc-800 flex flex-col z-30 shadow-2xl flex-shrink-0">
          
          {/* Preview Panel */}
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
            <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t('preview_title', lang)}</h3>
                <div className="text-[10px] text-zinc-400 font-mono">{frames.length > 0 ? `${currentPreviewIndex + 1} / ${frames.length}` : '0 / 0'}</div>
            </div>
            
            <div className="aspect-square w-full bg-zinc-100 dark:bg-zinc-950 rounded-lg border border-zinc-200 dark:border-zinc-800 flex items-center justify-center mb-4 relative checkerboard overflow-hidden shadow-inner group">
               {frames.length > 0 ? (
                 <img 
                    key={currentPreviewIndex}
                    src={frames[currentPreviewIndex]?.imageData} 
                    className="max-w-full max-h-full object-contain" 
                    style={{ imageRendering: 'pixelated' }} 
                 />
               ) : <span className="text-zinc-400 text-xs">{t('empty_list', lang)}</span>}
               {/* Preview Warp Target */}
               <div className={`absolute inset-0 bg-blue-500/20 pointer-events-none transition-opacity duration-300 ${previewWarp ? 'opacity-100' : 'opacity-0'}`} />
            </div>

            <div className="flex items-center gap-3">
               <button onClick={handlePlayClick} onMouseEnter={setupButtonHover} onMouseLeave={resetButtonHover} className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded font-medium text-sm transition-smooth ${isPlaying ? 'bg-amber-500/10 text-amber-600 dark:text-amber-500 hover:bg-amber-500/20' : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white border border-zinc-200 dark:border-zinc-700'}`}>
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
                        {frames.map((frame, index) => (
                            <SortableFrame key={frame.id} frame={frame} index={index} isSelected={selectedFrameIds.has(frame.id)} onSelect={handleFrameClick} onDelete={handleDeleteSingle} onContextMenu={(id, e) => {e.preventDefault(); e.stopPropagation(); const newSel = new Set(selectedFrameIds); if(!newSel.has(id)) { newSel.clear(); newSel.add(id); setSelectedFrameIds(newSel); setLastSelectedId(id); } setContextMenu({x:e.clientX, y:e.clientY, targetId:id, selectionSnapshot: newSel});}} />
                        ))}
                    {frames.length === 0 && <div className="w-full py-12 text-center text-zinc-400 text-xs italic select-none pointer-events-none">{t('empty_list', lang)}<br/>{t('empty_list_sub', lang)}</div>}
                  </div>
                </SortableContext>
              </DndContext>
              {selectionBox && <div className="fixed border border-blue-500 bg-blue-500/10 z-50 pointer-events-none" style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.w, height: selectionBox.h }} />}
            </div>
          </div>
        </div>

        {/* --- POPUPS / MODALS --- */}
        {/* Detection Settings */}
        {showDetectSettings && detectBtnRef.current && (
            <>
                <div className="fixed inset-0 z-40" onClick={() => setShowDetectSettings(false)} />
                <div className="fixed z-50 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl p-3 w-56 origin-top-right text-zinc-900 dark:text-zinc-100" style={{ top: detectBtnRef.current.getBoundingClientRect().bottom + 6, left: detectBtnRef.current.getBoundingClientRect().right, transform: 'translateX(-100%)' }}>
                    <div className="flex justify-between items-center mb-2"><span className="text-xs font-bold text-zinc-500 uppercase">{t('detect_settings', lang)}</span><button onClick={() => setShowDetectSettings(false)}><X size={12} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"/></button></div>
                    <div className="space-y-3">
                        <div className="flex items-center justify-between cursor-pointer group" onClick={() => setDetectIgnoreNested(!detectIgnoreNested)}><span className="text-sm">{t('merge_nested', lang)}</span><div className={`w-8 h-4 rounded-full p-0.5 transition-all duration-300 ${detectIgnoreNested ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-600'}`}><div className={`w-3 h-3 bg-white rounded-full shadow transition-all duration-300 ${detectIgnoreNested ? 'translate-x-4' : 'translate-x-0'}`} /></div></div>
                        <div><div className="flex justify-between text-xs text-zinc-500 mb-1"><span>{t('min_area', lang)}</span><span>{detectMinArea}px</span></div><input type="range" min="16" max="500" step="16" value={detectMinArea} onChange={(e) => setDetectMinArea(Number(e.target.value))} className="w-full h-1 bg-zinc-200 dark:bg-zinc-600 rounded-lg appearance-none cursor-pointer accent-indigo-500"/></div>
                    </div>
                </div>
            </>
        )}

        {/* Image Processor */}
        {showProcessorModal && image && <ImageProcessorModal key="processor" imageSrc={image.url} onClose={() => setShowProcessorModal(false)} onConfirm={handleImageUpdate} lang={lang} />}

        {/* Rotate Modal */}
        {showRotateModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden flex flex-col text-zinc-900 dark:text-zinc-100">
                <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900"><h3 className="text-lg font-bold flex items-center gap-2"><RefreshCw size={20} className="text-purple-500"/>{t('modal_rotate_title', lang)}</h3></div>
                <div className="p-6 space-y-6 bg-white dark:bg-zinc-900/50">
                    <div><label className="flex justify-between text-zinc-500 text-xs mb-2 font-bold uppercase"><span>{t('frames_count', lang)}</span><span className="text-purple-500 font-mono">{rotateFrameCount}</span></label><input type="range" min="4" max="36" step="1" value={rotateFrameCount} onChange={(e) => setRotateFrameCount(Number(e.target.value))} className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500"/></div>
                    <div className="h-px bg-zinc-200 dark:bg-zinc-800"></div>
                    <div className="space-y-3">
                        <div className={`group flex flex-col p-3 rounded-lg border cursor-pointer transition-all ${rotateUseBlur ? 'bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/50' : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'}`}>
                            <div className="flex items-center justify-between w-full" onClick={() => setRotateUseBlur(!rotateUseBlur)}><div className="flex items-center gap-3"><div className={`p-2 rounded ${rotateUseBlur ? 'bg-purple-500 text-white' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'}`}><Wind size={16} /></div><div className="flex flex-col"><span className={`text-sm font-medium ${rotateUseBlur ? 'text-purple-600 dark:text-purple-300' : 'text-zinc-700 dark:text-zinc-300'}`}>{t('motion_blur', lang)}</span><span className="text-[10px] text-zinc-500">{t('motion_blur_desc', lang)}</span></div></div><div className={`w-4 h-4 rounded-full border ${rotateUseBlur ? 'bg-purple-500 border-purple-500' : 'border-zinc-300 dark:border-zinc-600'}`}></div></div>
                            {rotateUseBlur && (<div className="mt-4 space-y-3 pl-2 pr-1"><div><div className="flex justify-between text-[10px] text-zinc-500 mb-1"><span className="flex items-center gap-1"><Aperture size={10}/> {t('blur_angle', lang)}</span><span>{rotateBlurAngle}°</span></div><input type="range" min="5" max="45" value={rotateBlurAngle} onChange={(e) => setRotateBlurAngle(Number(e.target.value))} className="w-full h-1 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-400"/></div></div>)}
                        </div>
                        <div className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${rotateReplace ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/50' : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'}`} onClick={() => setRotateReplace(!rotateReplace)}><div className="flex items-center gap-3"><div className={`p-2 rounded ${rotateReplace ? 'bg-blue-500 text-white' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'}`}><Replace size={16} /></div><div className="flex flex-col"><span className={`text-sm font-medium ${rotateReplace ? 'text-blue-600 dark:text-blue-300' : 'text-zinc-700 dark:text-zinc-300'}`}>{t('replace_origin', lang)}</span><span className="text-[10px] text-zinc-500">{t('replace_origin_desc', lang)}</span></div></div><div className={`w-4 h-4 rounded-full border ${rotateReplace ? 'bg-blue-500 border-blue-500' : 'border-zinc-300 dark:border-zinc-600'}`}></div></div>
                    </div>
                </div>
                <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex gap-3">
                <button onClick={() => setShowRotateModal(false)} className="flex-1 py-2.5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg text-sm font-medium transition-colors">{t('btn_cancel', lang)}</button>
                <button onClick={handleGenerateRotation} className="flex-[2] py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold shadow-lg shadow-purple-900/20 text-sm flex items-center justify-center gap-2 transition-transform active:scale-95"><RefreshCw size={16}/> {t('btn_start_gen', lang)}</button>
                </div>
            </div>
            </div>
        )}

        {/* Export Modal */}
        {showExportModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-xl shadow-2xl max-w-sm w-full mx-4 text-zinc-900 dark:text-zinc-100">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Archive size={20} className="text-blue-500"/>{t('export_title', lang)}</h3>
                <p className="text-zinc-500 mb-6 text-sm">{t('export_desc', lang, {n: frames.length})}</p>
                <div className="flex flex-col gap-3">
                {frames.length === 1 && <button onClick={() => performExport('png')} className="w-full py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white rounded-lg font-medium transition-colors">{t('export_png', lang)}</button>}
                <button onClick={() => performExport('zip')} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors">{t('export_zip', lang)}</button>
                <button onClick={() => setShowExportModal(false)} className="mt-2 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 text-sm py-2 transition-colors">{t('btn_cancel', lang)}</button>
                </div>
            </div>
            </div>
        )}
      </div>
  );
}