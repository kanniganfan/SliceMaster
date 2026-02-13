import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
    X, Check, Eraser, Wand2, RotateCcw, Eye, EyeOff, 
    Undo2, Redo2, Paintbrush, Sliders,
    ZoomIn, ZoomOut, Move
} from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { floodFill, featherEdges } from '../utils/imageProcessor';
import { t, Lang } from '../utils/i18n';

interface ImageProcessorModalProps {
  imageSrc: string;
  onClose: () => void;
  onConfirm: (newImageSrc: string) => void;
  lang: Lang;
}

type ToolType = 'wand' | 'eraser' | 'restore' | 'pan';

export const ImageProcessorModal: React.FC<ImageProcessorModalProps> = ({
  imageSrc,
  onClose,
  onConfirm,
  lang
}) => {
  // Canvas Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Interaction State
  const [isExiting, setIsExiting] = useState(false);

  // GSAP Entrance
  useGSAP(() => {
    const tl = gsap.timeline();
    // Modal Entrance
    tl.fromTo(rootRef.current, 
        { scale: 0.9, opacity: 0, filter: "blur(10px)" },
        { scale: 1, opacity: 1, filter: "blur(0px)", duration: 0.4, ease: "power3.out" }
    );
    // Tools Stagger
    tl.from(".tool-btn", {
        x: -20,
        opacity: 0,
        stagger: 0.05,
        duration: 0.3,
        ease: "back.out(1.2)"
    }, "-=0.2");
    
  }, { scope: rootRef });

  // Unified Exit Animation
  const animateExit = (callback: () => void) => {
      setIsExiting(true);
      // Disable interaction to prevent double clicks during exit
      if (rootRef.current) rootRef.current.style.pointerEvents = 'none';
      
      gsap.to(rootRef.current, {
          scale: 0.95,
          opacity: 0,
          filter: "blur(10px)",
          duration: 0.3,
          ease: "power2.in",
          onComplete: callback
      });
  };

  const handleCloseAnim = () => animateExit(onClose);

  // History
  const historyRef = useRef<ImageData[]>([]);
  const [historyStep, setHistoryStep] = useState(-1);

  // Viewport State (Zoom/Pan)
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const startPan = useRef({ x: 0, y: 0 });

  // Tool State
  const [activeTool, setActiveTool] = useState<ToolType>('wand');
  const [prevTool, setPrevTool] = useState<ToolType>('wand'); 
  const [isComparing, setIsComparing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Cursor State
  const [cursorPos, setCursorPos] = useState<{x: number, y: number} | null>(null);
  
  // Settings
  const [wandTolerance, setWandTolerance] = useState(20);
  const [wandContiguous, setWandContiguous] = useState(true);
  const [brushSize, setBrushSize] = useState(30);
  const [brushHardness, setBrushHardness] = useState(80);
  const [globalFeather, setGlobalFeather] = useState(0);

  // Drawing Interaction
  const isDrawing = useRef(false);
  const lastDrawPos = useRef<{x: number, y: number} | null>(null);

   useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement) return;
        if (e.ctrlKey || e.metaKey) {
            if (e.key === '=' || e.key === '+') { e.preventDefault(); handleZoom(0.1); return; }
            if (e.key === '-' || e.key === '_') { e.preventDefault(); handleZoom(-0.1); return; }
            if (e.key === '0') { e.preventDefault(); setScale(1); setOffset({ x: 0, y: 0 }); return; }
        }
        switch(e.key.toLowerCase()) {
            case 'w': setActiveTool('wand'); break;
            case 'e': setActiveTool('eraser'); break;
            case 'r': setActiveTool('restore'); break;
            case 'h': setActiveTool('pan'); break;
            case ' ': if (activeTool !== 'pan') { setPrevTool(activeTool); setActiveTool('pan'); } e.preventDefault(); break;
            case 'z': if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.shiftKey ? redo() : undo(); } break;
        }
    };
    const handleKeyUp = (e: KeyboardEvent) => { if (e.key === ' ' && activeTool === 'pan') setActiveTool(prevTool); };
    window.addEventListener('keydown', handleKeyDown); window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [activeTool, prevTool, historyStep]);

  useEffect(() => {
    const img = new Image(); img.crossOrigin = 'Anonymous'; img.src = imageSrc;
    img.onload = () => {
      originalImageRef.current = img;
      const container = canvasWrapperRef.current;
      if (container) {
          const availW = container.clientWidth - 64; const availH = container.clientHeight - 64;
          const scaleW = availW / img.width; const scaleH = availH / img.height;
          setScale(Math.min(scaleW, scaleH, 1));
      }
      initCanvas(img);
    };
  }, [imageSrc]);

  const initCanvas = (img: HTMLImageElement) => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) return;
    ctx.drawImage(img, 0, 0); saveHistory();
  };

  const saveHistory = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const newHistory = historyRef.current.slice(0, historyStep + 1);
    newHistory.push(imageData); if (newHistory.length > 20) newHistory.shift();
    historyRef.current = newHistory; setHistoryStep(newHistory.length - 1);
  };

  const undo = () => { if (historyStep > 0) { const newStep = historyStep - 1; setHistoryStep(newStep); putImageData(historyRef.current[newStep]); }};
  const redo = () => { if (historyStep < historyRef.current.length - 1) { const newStep = historyStep + 1; setHistoryStep(newStep); putImageData(historyRef.current[newStep]); }};
  const putImageData = (imageData: ImageData) => { const canvas = canvasRef.current; const ctx = canvas?.getContext('2d'); if (canvas && ctx) ctx.putImageData(imageData, 0, 0); };
  const handleZoom = (delta: number) => { setScale(s => Math.min(Math.max(0.1, s + delta), 5)); };
  const handleWheel = (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); handleZoom(e.deltaY > 0 ? -0.1 : 0.1); } 
      else { setOffset(prev => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY })); }
  };

  const getCanvasCoords = (clientX: number, clientY: number) => {
      const canvas = canvasRef.current; if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width > 0 ? rect.width / canvas.width : 1;
      const scaleY = canvas.height > 0 ? rect.height / canvas.height : 1;
      return { x: Math.floor((clientX - rect.left) / scaleX), y: Math.floor((clientY - rect.top) / scaleY) };
  };
  const handlePointerDown = (e: React.PointerEvent) => {
      if (activeTool === 'pan' || e.button === 1) { setIsPanning(true); startPan.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }; canvasWrapperRef.current?.setPointerCapture(e.pointerId); return; }
      const { x, y } = getCanvasCoords(e.clientX, e.clientY);
      if (activeTool === 'wand') handleWand(x, y);
      else if (activeTool === 'eraser' || activeTool === 'restore') { isDrawing.current = true; drawBrush(x, y); lastDrawPos.current = { x, y }; canvasWrapperRef.current?.setPointerCapture(e.pointerId); }
  };
  const handlePointerMove = (e: React.PointerEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY });
      if (isPanning) { setOffset({ x: e.clientX - startPan.current.x, y: e.clientY - startPan.current.y }); return; }
      if (isDrawing.current && (activeTool === 'eraser' || activeTool === 'restore')) {
          const { x, y } = getCanvasCoords(e.clientX, e.clientY);
          if (lastDrawPos.current) {
              const dist = Math.hypot(x - lastDrawPos.current.x, y - lastDrawPos.current.y);
              const angle = Math.atan2(y - lastDrawPos.current.y, x - lastDrawPos.current.x);
              const step = Math.max(1, brushSize / 4); 
              for (let i = 0; i < dist; i += step) { drawBrush(lastDrawPos.current.x + Math.cos(angle) * i, lastDrawPos.current.y + Math.sin(angle) * i); }
          }
          drawBrush(x, y); lastDrawPos.current = { x, y };
      }
  };
  const handlePointerUp = (e: React.PointerEvent) => {
      if (isPanning) { setIsPanning(false); canvasWrapperRef.current?.releasePointerCapture(e.pointerId); } 
      else if (isDrawing.current) { isDrawing.current = false; lastDrawPos.current = null; canvasWrapperRef.current?.releasePointerCapture(e.pointerId); saveHistory(); }
  };
  const handleWand = (x: number, y: number) => {
      setIsProcessing(true);
      setTimeout(() => {
          const canvas = canvasRef.current; const ctx = canvas?.getContext('2d', { willReadFrequently: true });
          if (ctx && canvas) {
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const idx = (y * canvas.width + x) * 4;
              floodFill(imageData, x, y, { r: imageData.data[idx], g: imageData.data[idx+1], b: imageData.data[idx+2], a: imageData.data[idx+3] }, wandTolerance, wandContiguous);
              ctx.putImageData(imageData, 0, 0); saveHistory();
          }
          setIsProcessing(false);
      }, 10);
  };
  const drawBrush = (x: number, y: number) => {
      const canvas = canvasRef.current; const ctx = canvas?.getContext('2d'); if (!ctx || !canvas || !originalImageRef.current) return;
      ctx.save(); ctx.beginPath(); const radius = brushSize / 2;
      if (activeTool === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out';
          if (brushHardness < 100) {
              const grad = ctx.createRadialGradient(x, y, radius * (brushHardness/100), x, y, radius);
              grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = grad; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
          } else { ctx.arc(x, y, radius, 0, Math.PI*2); ctx.fillStyle = 'rgba(0,0,0,1)'; ctx.fill(); }
      } else if (activeTool === 'restore') {
          ctx.globalCompositeOperation = 'source-over'; ctx.arc(x, y, radius, 0, Math.PI*2); ctx.clip(); ctx.drawImage(originalImageRef.current, 0, 0);
      }
      ctx.restore();
  };

  const handleConfirm = () => {
      const canvas = canvasRef.current; if (!canvas) return;
      let finalData = canvas.toDataURL();
      if (globalFeather > 0) {
          const temp = document.createElement('canvas'); temp.width = canvas.width; temp.height = canvas.height;
          const tCtx = temp.getContext('2d');
          if (tCtx) { 
              tCtx.drawImage(canvas, 0, 0); 
              const iData = tCtx.getImageData(0, 0, temp.width, temp.height); 
              featherEdges(iData, globalFeather); 
              tCtx.putImageData(iData, 0, 0); 
              finalData = temp.toDataURL(); 
          }
      }
      // Animate Exit then Confirm
      animateExit(() => onConfirm(finalData));
  };

  const getToolTitle = () => { switch(activeTool) { case 'wand': return t('tool_wand_short', lang); case 'eraser': return t('tool_eraser_short', lang); case 'restore': return t('tool_restore_short', lang); case 'pan': return t('tool_move', lang); }};
  const getToolDesc = () => { switch(activeTool) { case 'wand': return t('proc_wand_tip', lang); case 'eraser': case 'restore': return t('proc_brush_tip', lang); case 'pan': return t('proc_pan_tip', lang); }};

  return (
    <div 
        ref={rootRef}
        className="fixed inset-0 z-50 bg-zinc-50 dark:bg-zinc-950 flex flex-col text-zinc-900 dark:text-zinc-100"
    >
      {/* 1. TOP BAR */}
      <div className="h-14 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-4 z-20 flex-shrink-0 shadow-sm">
          {/* ... Content same as before ... */}
          <div className="flex items-center gap-4">
              <span className="font-bold flex items-center gap-2">
                  <Paintbrush className="text-pink-500" size={18} />
                  {t('proc_title', lang)}
              </span>
              <div className="h-4 w-px bg-zinc-300 dark:bg-zinc-700"></div>
              <div className="flex items-center gap-1">
                  <button onClick={undo} disabled={historyStep <= 0} className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 transition-smooth rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><Undo2 size={18} /></button>
                  <button onClick={redo} disabled={historyStep >= historyRef.current.length - 1} className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 transition-smooth rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><Redo2 size={18} /></button>
              </div>
          </div>
          <div className="flex items-center gap-2">
             <button onMouseDown={() => setIsComparing(true)} onMouseUp={() => setIsComparing(false)} onMouseLeave={() => setIsComparing(false)} className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs rounded border border-zinc-200 dark:border-zinc-700 transition-smooth flex items-center gap-2 select-none">
                {isComparing ? <Eye size={14} /> : <EyeOff size={14} />} {t('proc_compare', lang)}
             </button>
             <button onClick={handleCloseAnim} className="px-4 py-1.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-smooth text-sm">{t('btn_cancel', lang)}</button>
             <button onClick={handleConfirm} className="px-5 py-1.5 bg-pink-600 hover:bg-pink-500 text-white rounded font-medium shadow-lg shadow-pink-900/20 dark:shadow-pink-900/40 text-sm flex items-center gap-2 active:scale-95 transition-transform"><Check size={16} /> {t('proc_finish', lang)}</button>
          </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* 2. LEFT SIDEBAR */}
        <div className="w-16 flex flex-col items-center py-4 gap-4 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 z-20">
            <ToolButton icon={<Move size={20} />} label={t('tool_move', lang)} active={activeTool === 'pan'} onClick={() => setActiveTool('pan')} />
            <div className="w-8 h-px bg-zinc-200 dark:bg-zinc-800"></div>
            <ToolButton icon={<Wand2 size={20} />} label={t('tool_wand_short', lang)} active={activeTool === 'wand'} onClick={() => setActiveTool('wand')} color="blue" />
            <ToolButton icon={<Eraser size={20} />} label={t('tool_eraser_short', lang)} active={activeTool === 'eraser'} onClick={() => setActiveTool('eraser')} color="red" />
            <ToolButton icon={<RotateCcw size={20} />} label={t('tool_restore_short', lang)} active={activeTool === 'restore'} onClick={() => setActiveTool('restore')} color="emerald" />
        </div>

        {/* 3. MAIN WORKSPACE */}
        <div 
            ref={canvasWrapperRef}
            className={`flex-1 relative overflow-hidden bg-zinc-50 dark:bg-zinc-950 checkerboard touch-none ${activeTool === 'pan' || isPanning ? 'cursor-grab active:cursor-grabbing' : 'cursor-none'}`}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
        >
            <div className="absolute left-1/2 top-1/2 origin-center will-change-transform" style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`, width: canvasRef.current?.width || 0, height: canvasRef.current?.height || 0 }}>
                <img ref={originalImageRef} src={imageSrc} className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${isComparing ? 'opacity-100 z-10' : 'opacity-0'}`} draggable={false} alt="" />
                <canvas ref={canvasRef} className="block w-full h-full image-pixelated" />
            </div>

            {/* Custom Cursor */}
            {cursorPos && !isPanning && activeTool !== 'pan' && !isExiting && createPortal(
                <div className="fixed pointer-events-none z-[9999] flex items-center justify-center will-change-transform" style={{ left: cursorPos.x, top: cursorPos.y, transform: 'translate(-50%, -50%)' }}>
                    {activeTool === 'wand' && (
                        <div className="relative">
                            <div className="absolute w-px h-6 bg-zinc-900 dark:bg-black -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2"></div>
                            <div className="absolute w-px h-6 bg-zinc-100 dark:bg-white -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2 rotate-90"></div>
                            <div className="w-4 h-4 border border-zinc-100 dark:border-white bg-black/20 rounded-full shadow-sm"></div>
                        </div>
                    )}
                    {(activeTool === 'eraser' || activeTool === 'restore') && (
                        <div style={{ width: Math.max(4, brushSize * scale), height: Math.max(4, brushSize * scale), borderColor: activeTool === 'restore' ? '#10b981' : '#f43f5e' }} className="rounded-full border-2 bg-white/10 shadow-[0_0_0_1px_rgba(0,0,0,0.5)] box-border" />
                    )}
                </div>,
                document.body
            )}
            
            {/* Viewport Info */}
            <div className="absolute bottom-4 left-4 bg-white/90 dark:bg-zinc-900/90 backdrop-blur border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 rounded-full text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-3 pointer-events-auto shadow-lg" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
                 <button onClick={() => setScale(1)} className="hover:text-zinc-900 dark:hover:text-white transition-colors">{(scale * 100).toFixed(0)}%</button>
                 <div className="w-px h-3 bg-zinc-300 dark:bg-zinc-700"></div>
                 <div className="flex gap-1">
                     <button onClick={() => handleZoom(-0.1)} className="p-0.5 hover:text-zinc-900 dark:hover:text-white transition-colors"><ZoomOut size={14}/></button>
                     <button onClick={() => handleZoom(0.1)} className="p-0.5 hover:text-zinc-900 dark:hover:text-white transition-colors"><ZoomIn size={14}/></button>
                 </div>
            </div>
            {isProcessing && <div className="absolute inset-0 flex items-center justify-center bg-white/40 dark:bg-black/40 backdrop-blur-[1px] z-50"><div className="flex flex-col items-center gap-2"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900 dark:border-white"></div><span className="text-xs text-zinc-900 dark:text-white shadow-white dark:shadow-black drop-shadow-md">Processing...</span></div></div>}
        </div>

        {/* 4. RIGHT SIDEBAR */}
        <div className="w-72 bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 flex flex-col z-20 overflow-y-auto">
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">{getToolTitle()}</h3>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">{getToolDesc()}</p>
            </div>
            <div className="p-4 space-y-6 flex-1">
                {activeTool === 'wand' && (
                    <div className="space-y-4">
                        <SettingSlider label={`${t('setting_tolerance', lang)} (Tolerance)`} value={wandTolerance} min={1} max={100} onChange={setWandTolerance} color="blue" />
                        <div className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700">
                            <span className="text-xs text-zinc-600 dark:text-zinc-300">{t('setting_contiguous', lang)}</span>
                            <div className={`w-10 h-5 rounded-full p-0.5 cursor-pointer transition-colors ${wandContiguous ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'}`} onClick={() => setWandContiguous(!wandContiguous)}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${wandContiguous ? 'translate-x-5' : 'translate-x-0'}`} />
                            </div>
                        </div>
                    </div>
                )}
                {(activeTool === 'eraser' || activeTool === 'restore') && (
                    <div className="space-y-4">
                        <SettingSlider label={`${t('setting_brush_size', lang)} (Size)`} value={brushSize} min={1} max={300} onChange={setBrushSize} color={activeTool === 'restore' ? 'emerald' : 'red'} />
                        <SettingSlider label={`${t('setting_hardness', lang)} (Hardness)`} value={brushHardness} min={0} max={100} onChange={setBrushHardness} color={activeTool === 'restore' ? 'emerald' : 'red'} />
                    </div>
                )}
                <div className="h-px bg-zinc-200 dark:bg-zinc-800 my-2"></div>
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase"><Sliders size={12} /> {t('setting_global', lang)}</div>
                    <SettingSlider label={`${t('setting_feather', lang)} (Feather)`} value={globalFeather} min={0} max={10} step={0.5} onChange={setGlobalFeather} color="pink" subLabel={t('setting_output', lang)} />
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

// ToolButton with GSAP hover
const ToolButton = ({ icon, label, active, onClick, color = 'zinc' }: any) => {
    const btnRef = useRef<HTMLButtonElement>(null);

    const handleMouseEnter = () => {
        if (btnRef.current) gsap.to(btnRef.current, { scale: 1.15, duration: 0.4, ease: "elastic.out(1, 0.3)" });
    };
    
    const handleMouseLeave = () => {
        if (btnRef.current) gsap.to(btnRef.current, { scale: 1, duration: 0.2, ease: "power2.out" });
    };

    const activeClass = {
        blue: 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 border-l-2 border-blue-500',
        red: 'bg-red-50 dark:bg-red-600/20 text-red-600 dark:text-red-400 border-l-2 border-red-500',
        emerald: 'bg-emerald-50 dark:bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border-l-2 border-emerald-500',
        zinc: 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-white'
    }[color as string] || 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-white';
    
    return (
        <button 
            ref={btnRef}
            onClick={onClick} 
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className={`tool-btn w-10 h-10 flex items-center justify-center rounded transition-colors duration-200 group relative ${active ? activeClass : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
        >
            {icon}
            <span className="absolute left-full ml-2 px-2 py-1 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs rounded border border-zinc-200 dark:border-zinc-700 opacity-0 group-hover:opacity-100 whitespace-nowrap z-50 pointer-events-none transition-opacity shadow-lg">{label}</span>
        </button>
    );
};

const SettingSlider = ({ label, value, min, max, step = 1, onChange, color, subLabel }: any) => {
    const accentClass = {
        blue: 'accent-blue-500 hover:accent-blue-400',
        red: 'accent-red-500 hover:accent-red-400',
        emerald: 'accent-emerald-500 hover:accent-emerald-400',
        pink: 'accent-pink-500 hover:accent-pink-400',
    }[color as string] || 'accent-zinc-500 hover:accent-zinc-400';

    return (
        <div>
            <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400 mb-2 font-medium"><span>{label}</span><span className="text-zinc-900 dark:text-zinc-200">{value}</span></div>
            <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className={`w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer ${accentClass} transition-all`} />
            {subLabel && <p className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-1">{subLabel}</p>}
        </div>
    );
};